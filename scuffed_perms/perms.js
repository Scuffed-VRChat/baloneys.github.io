// scuffed_perms/perms.js: edit the Scuffed role lists in scuffed_perms/roles/ straight from the site.
//
// There's no server: the page talks to the GitHub API with a GitHub token you paste in. The token stays
// in this browser (this tab only, unless you tick "remember"); it's never written into the site.
// Anyone can VIEW the lists without a token. Saving needs a token that can write to this repo.
//
// One save = one commit holding every changed role file AND a rebuilt all.txt (the one-file bundle the
// world downloads), so the world never sees a half-updated set. If someone else changed a list you
// edited since you loaded the page, the save stops and asks you to reload instead of overwriting them.
// all.txt is built exactly like .github/scripts/combine-scuffed-perms.sh; keep the two in step.
(function () {
  'use strict';

  var OWNER = 'Scuffed-VRChat', REPO = 'baloneys.github.io', BRANCH = 'main';
  var DIR = 'scuffed_perms/roles', BUNDLE = 'all.txt';
  var API = 'https://api.github.com/repos/' + OWNER + '/' + REPO;
  var RAW = 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/refs/heads/' + BRANCH + '/' + DIR + '/';
  var TOKEN_KEY = 'scuffed-perms-token';

  // Friendly names, in the order the world checks them (top wins). Unknown files show after these.
  var KNOWN = [
    ['devs.txt', 'Dev'], ['com lead', 'Com Lead'], ['mod.txt', 'Mod'], ['testers.txt', 'Tester'],
    ['groupowners.txt', 'Group Owner'], ['djs.txt', 'Event DJ'], ['premiums.txt', 'Prem']
  ];

  var token = '';
  var canWrite = false;
  var roles = [];        // { file, label, sha, base: [lines], entries: [{text, comment}], added: {}, removed: {} }
  var loadedHead = '';   // commit the lists were loaded from
  var busy = false;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function status(id, text, kind) { var s = $(id); s.textContent = text || ''; s.className = 'perms-status' + (kind ? ' is-' + kind : ''); }
  function lower(s) { return String(s).toLowerCase(); }
  function byteOrder(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  /* ---------- token ---------- */

  function readToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function storeToken(t, remember) {
    try {
      sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY);
      if (t) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
    } catch (e) { /* storage blocked: the token just lasts until the page closes */ }
  }
  function rememberedToken() { try { return !!localStorage.getItem(TOKEN_KEY); } catch (e) { return false; } }

  /* ---------- GitHub API ---------- */

  function gh(path, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(path.indexOf('https://') === 0 ? path : API + path, {
      method: opts.method || 'GET', headers: headers, cache: 'no-store',
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = t; }
        if (!r.ok) {
          var msg = data && data.message ? data.message : 'HTTP ' + r.status;
          if (r.status === 401) msg = 'GitHub didn\'t accept that token (' + msg + ').';
          if (r.status === 403 && /rate limit/i.test(msg)) msg = 'GitHub\'s rate limit for visitors without a token is used up. Connect a token or try again in an hour.';
          var err = new Error(msg); err.status = r.status; throw err;
        }
        return data;
      });
    });
  }

  function decodeBase64(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function headCommit() { return gh('/git/ref/heads/' + BRANCH).then(function (d) { return d.object.sha; }); }

  // { name: { sha, text } } for every role file at a commit (all.txt left out).
  function fetchLists(commit) {
    return gh('/contents/' + encodeURI(DIR) + '?ref=' + commit).then(function (items) {
      var files = (items || []).filter(function (it) { return it.type === 'file' && it.name !== BUNDLE; });
      return Promise.all(files.map(function (f) {
        return gh('/git/blobs/' + f.sha).then(function (b) { return { name: f.name, sha: f.sha, text: decodeBase64(b.content) }; });
      }));
    }).then(function (list) {
      var out = {};
      list.forEach(function (f) { out[f.name] = f; });
      return out;
    });
  }

  /* ---------- role files ---------- */

  function splitLines(text) {
    return String(text || '').replace(/\r/g, '').split('\n').filter(function (l) { return !/^\s*$/.test(l); });
  }

  function makeRole(name, sha, text) {
    var key = lower(name), label = null, rank = KNOWN.length;
    for (var i = 0; i < KNOWN.length; i++) if (KNOWN[i][0] === key) { label = KNOWN[i][1]; rank = i; }
    if (!label) label = name.replace(/\.txt$/i, '');
    var lines = splitLines(text);
    return {
      file: name, label: label, rank: rank, sha: sha, base: lines,
      entries: lines.map(function (l) { var t = l.trim(); return { text: t, comment: t.charAt(0) === '#' || t.indexOf('//') === 0 }; }),
      added: {}, removed: {}, note: '', noteBad: false
    };
  }

  function names(role) { return role.entries.filter(function (e) { return !e.comment; }).map(function (e) { return e.text; }); }
  function hasName(role, name) { return names(role).some(function (n) { return lower(n) === lower(name); }); }

  // The file as it'll be saved: the loaded lines in order, minus removals, plus additions at the end.
  function outputLines(role) {
    var out = [];
    role.entries.forEach(function (e) { if (e.comment || !role.removed[lower(e.text)]) out.push(e.text); });
    Object.keys(role.added).forEach(function (k) { out.push(role.added[k]); });
    return out;
  }
  function serialize(lines) { return lines.length ? lines.join('\n') + '\n' : ''; }
  function isChanged(role) { return Object.keys(role.added).length > 0 || Object.keys(role.removed).length > 0; }
  function changedRoles() { return roles.filter(isChanged); }

  // Same output as .github/scripts/combine-scuffed-perms.sh.
  function buildBundle(fileLines) {
    var out = [
      '# AUTO-GENERATED - do not edit this file.',
      '# Built from the other files in ' + DIR + '/ (kanaris-beans.com/scuffed_perms/ or .github/workflows/combine-scuffed-perms.yml).',
      '# Edit the individual role files instead.'
    ];
    Object.keys(fileLines).sort(byteOrder).forEach(function (name) {
      out.push('', '### FILE: ' + name);
      fileLines[name].forEach(function (l) { out.push(l); });
    });
    return out.join('\n') + '\n';
  }

  /* ---------- editing ---------- */

  function problemWith(name) {
    if (!name) return 'Type a display name first.';
    if (name.indexOf(',') >= 0) return 'Names can\'t contain commas (the world reads a comma as "next name").';
    if (name.charAt(0) === '#' || name.indexOf('//') === 0) return 'Names can\'t start with # or // (the world treats those lines as comments).';
    if (name.indexOf('### FILE:') === 0) return 'That name is reserved.';
    return '';
  }

  function addNames(role, raw) {
    var list = String(raw).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var added = 0, skipped = [];
    for (var i = 0; i < list.length; i++) {
      var n = list[i], k = lower(n), problem = problemWith(n);
      if (problem) { role.note = problem; role.noteBad = true; render(); return false; }
      if (role.removed[k]) { delete role.removed[k]; added++; continue; }     // was marked for removal: just keep it
      if (role.added[k] || hasName(role, n)) { skipped.push(n); continue; }
      role.added[k] = n; added++;
    }
    role.note = skipped.length ? 'Already on the list: ' + skipped.join(', ') : '';
    role.noteBad = false;
    render();
    return added > 0 || skipped.length > 0;
  }

  function toggleRemove(role, name) {
    var k = lower(name);
    if (role.added[k]) delete role.added[k];
    else if (role.removed[k]) delete role.removed[k];
    else role.removed[k] = true;
    render();
  }

  /* ---------- rendering ---------- */

  function chip(role, name, kind, query) {
    var c = el('span', 'perms-chip' + (kind ? ' is-' + kind : ''));
    c.appendChild(el('span', null, name));
    if (query) c.classList.add(lower(name).indexOf(query) >= 0 ? 'is-hit' : 'is-dim');
    if (canWrite) {
      var b = el('button', null, kind === 'removed' ? '↺' : '×');
      b.type = 'button';
      b.title = kind === 'removed' ? 'Keep ' + name : kind === 'added' ? 'Don\'t add ' + name : 'Remove ' + name;
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', function () { toggleRemove(role, name); });
      c.appendChild(b);
    }
    return c;
  }

  function render() {
    var grid = $('roleGrid');
    grid.textContent = '';
    var query = lower($('search').value.trim());
    roles.forEach(function (role) {
      var card = el('article', 'perms-role' + (isChanged(role) ? ' is-changed' : ''));
      var head = el('div', 'perms-role-head');
      var title = el('div');
      title.appendChild(el('div', 'perms-role-name', role.label));
      title.appendChild(el('div', 'perms-role-file', role.file));
      head.appendChild(title);
      var current = names(role).filter(function (n) { return !role.removed[lower(n)]; }).length + Object.keys(role.added).length;
      head.appendChild(el('div', 'perms-role-count', current + (current === 1 ? ' player' : ' players')));
      card.appendChild(head);

      var chips = el('div', 'perms-chips');
      names(role).forEach(function (n) { chips.appendChild(chip(role, n, role.removed[lower(n)] ? 'removed' : '', query)); });
      Object.keys(role.added).forEach(function (k) { chips.appendChild(chip(role, role.added[k], 'added', query)); });
      if (!chips.childNodes.length) chips.appendChild(el('span', 'perms-empty', 'Nobody yet'));
      card.appendChild(chips);

      if (canWrite) {
        var form = el('form', 'perms-row');
        var input = el('input', 'perms-input');
        input.placeholder = 'Add a VRChat display name';
        input.setAttribute('aria-label', 'Add a player to ' + role.label);
        input.autocomplete = 'off';
        var add = el('button', 'btn btn-sm btn-primary', 'Add'); add.type = 'submit';
        form.appendChild(input); form.appendChild(add);
        var note = el('p', 'perms-status' + (role.note && role.noteBad ? ' is-bad' : ''), role.note || '');
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var keep = input.value;
          if (!addNames(role, keep)) {
            var box = document.querySelector('[data-role-input="' + CSS.escape(role.file) + '"]');
            if (box) box.value = keep;   // bad name: leave it in the box to fix
          }
          // render() rebuilt the card: put the cursor back in this role's box
          var again = document.querySelector('[data-role-input="' + CSS.escape(role.file) + '"]');
          if (again) again.focus();
        });
        input.setAttribute('data-role-input', role.file);
        card.appendChild(form);
        card.appendChild(note);
        if (isChanged(role)) {
          var undo = el('button', 'btn btn-sm btn-outline', 'Undo changes to ' + role.label); undo.type = 'button';
          undo.addEventListener('click', function () { role.added = {}; role.removed = {}; render(); });
          card.appendChild(undo);
        }
      }
      grid.appendChild(card);
    });
    renderSaveBar();
  }

  function summary() {
    return changedRoles().map(function (role) {
      var parts = [];
      Object.keys(role.added).forEach(function (k) { parts.push('+' + role.added[k]); });
      names(role).forEach(function (n) { if (role.removed[lower(n)]) parts.push('-' + n); });
      return role.label + ' ' + parts.join(' ');
    });
  }

  function renderSaveBar() {
    var changed = changedRoles();
    $('saveBar').classList.toggle('hidden', !changed.length);
    $('saveSummary').textContent = changed.length ? summary().join(' · ') : '';
  }

  /* ---------- load / save ---------- */

  function load(doneMessage) {
    if (busy) return;
    if (typeof doneMessage !== 'string') doneMessage = '';
    if (changedRoles().length && !confirm('Reloading throws away your unsaved changes. Reload anyway?')) return;
    busy = true;
    status('loadStatus', 'Loading the lists…');
    headCommit().then(function (head) {
      return fetchLists(head).then(function (files) {
        loadedHead = head;
        roles = Object.keys(files).map(function (n) { return makeRole(n, files[n].sha, files[n].text); });
        roles.sort(function (a, b) { return a.rank - b.rank || byteOrder(lower(a.file), lower(b.file)); });
        $('editor').classList.remove('hidden');
        status('loadStatus', doneMessage || 'Loaded ' + roles.length + ' role lists' + (canWrite ? '.' : ' (view only: connect a token to make changes).'), 'good');
        render();
      });
    }).catch(function (e) {
      status('loadStatus', 'Couldn\'t load the lists: ' + e.message, 'bad');
    }).then(function () { busy = false; });
  }

  function save(retried) {
    if (busy || !canWrite) return;
    var changed = changedRoles();
    if (!changed.length) return;
    busy = true;
    $('saveBtn').disabled = true;
    status('saveStatus', 'Saving…');
    var head;
    headCommit().then(function (h) {
      head = h;
      return h === loadedHead ? null : fetchLists(h);
    }).then(function (latest) {
      var fileLines = {};
      roles.forEach(function (r) { fileLines[r.file] = r.base; });
      if (latest) {
        // Someone committed since we loaded. Fine, unless they changed a list we're changing.
        var clash = changed.filter(function (r) { return !latest[r.file] || latest[r.file].sha !== r.sha; });
        if (clash.length) {
          var e = new Error('Someone else changed ' + clash.map(function (r) { return r.label; }).join(', ')
            + ' after you opened this page. Note your changes, press Reload, and make them again.');
          e.clash = true; throw e;
        }
        fileLines = {};
        Object.keys(latest).forEach(function (n) { fileLines[n] = splitLines(latest[n].text); });
      }
      var tree = [];
      changed.forEach(function (r) {
        var lines = outputLines(r);
        fileLines[r.file] = lines;
        tree.push({ path: DIR + '/' + r.file, mode: '100644', type: 'blob', content: serialize(lines) });
      });
      tree.push({ path: DIR + '/' + BUNDLE, mode: '100644', type: 'blob', content: buildBundle(fileLines) });
      var message = 'Scuffed perms: ' + summary().join('; ');
      if (message.length > 300) message = message.slice(0, 297) + '...';
      return gh('/git/commits/' + head).then(function (c) {
        return gh('/git/trees', { method: 'POST', body: { base_tree: c.tree.sha, tree: tree } });
      }).then(function (t) {
        return gh('/git/commits', { method: 'POST', body: { message: message + '\n\nSaved from kanaris-beans.com/scuffed_perms/', tree: t.sha, parents: [head] } });
      }).then(function (commit) {
        return gh('/git/refs/heads/' + BRANCH, { method: 'PATCH', body: { sha: commit.sha, force: false } }).then(function () { return commit; });
      });
    }).then(function (commit) {
      busy = false;
      roles.forEach(function (r) { r.added = {}; r.removed = {}; });
      status('saveStatus', '');
      $('saveBtn').disabled = false;
      load('Saved (' + commit.sha.slice(0, 7) + '). The world picks it up at its next role refresh, usually within 5–10 minutes.');
    }).catch(function (e) {
      busy = false;
      $('saveBtn').disabled = false;
      // The branch moved between our read and our write: try once more from the new head.
      if (!retried && !e.clash && (e.status === 422 || e.status === 409)) return save(true);
      status('saveStatus', 'Not saved: ' + e.message, 'bad');
    });
  }

  /* ---------- connect ---------- */

  function connect(t, remember) {
    token = t;
    status('tokenStatus', 'Checking the token…');
    return gh('').then(function (repo) {
      canWrite = !!(repo && repo.permissions && (repo.permissions.push || repo.permissions.admin));
      storeToken(token, remember);
      $('tokenForm').classList.add('hidden');
      $('signedIn').classList.remove('hidden');
      return gh('https://api.github.com/user').catch(function () { return null; }).then(function (me) {
        var who = me && me.login ? me.login : 'this token';
        status('tokenStatus', canWrite ? 'Connected as ' + who + '. You can edit and save.' : 'Connected as ' + who + ', but it can\'t write to ' + OWNER + '/' + REPO + ' (view only).', canWrite ? 'good' : 'bad');
      });
    }).catch(function (e) {
      token = ''; canWrite = false;
      storeToken('', false);
      status('tokenStatus', e.message, 'bad');
    }).then(load);
  }

  function boot() {
    $('bundleUrl').textContent = RAW + BUNDLE;
    $('repoLink').href = 'https://github.com/' + OWNER + '/' + REPO + '/tree/' + BRANCH + '/' + DIR;
    $('tokenForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var t = $('tokenInput').value.trim();
      if (!t) return status('tokenStatus', 'Paste a token first.', 'bad');
      $('tokenInput').value = '';
      connect(t, $('rememberToken').checked);
    });
    $('signOut').addEventListener('click', function () {
      if (changedRoles().length && !confirm('Disconnecting throws away your unsaved changes. Disconnect anyway?')) return;
      roles.forEach(function (r) { r.added = {}; r.removed = {}; });
      token = ''; canWrite = false; storeToken('', false);
      $('signedIn').classList.add('hidden'); $('tokenForm').classList.remove('hidden');
      status('tokenStatus', 'Disconnected. The token was removed from this browser.');
      load();
    });
    $('reload').addEventListener('click', function () { load(); });
    $('search').addEventListener('input', render);
    $('saveBtn').addEventListener('click', function () { save(false); });
    $('discard').addEventListener('click', function () {
      if (!confirm('Throw away every unsaved change?')) return;
      roles.forEach(function (r) { r.added = {}; r.removed = {}; });
      render();
    });
    $('copyUrl').addEventListener('click', function () {
      navigator.clipboard.writeText(RAW + BUNDLE).then(function () { $('copyUrl').textContent = 'Copied'; setTimeout(function () { $('copyUrl').textContent = 'Copy'; }, 1500); });
    });
    window.addEventListener('beforeunload', function (e) { if (changedRoles().length) { e.preventDefault(); e.returnValue = ''; } });

    var saved = readToken();
    $('rememberToken').checked = rememberedToken();
    if (saved) connect(saved, rememberedToken()); else load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
