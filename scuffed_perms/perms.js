// scuffed_perms/perms.js: edit the Scuffed role lists in scuffed_perms/roles/ from the site. ADMINS ONLY.
//
// Signing in is the same player account as the games and chat (games-social.js runs on this page too, so the
// profile, friends and notifications dock work here as well). "Admin" means admin or above on the moderation
// panel (/moderation.html): admin, developer, or the baloneys master login.
//
// The page never touches GitHub itself. It asks the scuffed-perms Worker (scuffed_perms/worker/), which checks
// the caller's staff level with Supabase on EVERY request and refuses anyone below admin, then reads or commits
// the lists with its own GitHub token. Hiding the editor below is only convenience; the Worker is the lock.
//
// One save = one commit with every changed list and a rebuilt all.txt (built by the Worker). If someone else
// changed a list you edited since you opened the page, the save stops and asks you to reload.
(function () {
  'use strict';

  var WORKER = 'https://scuffed-perms.seanboyle20126.workers.dev';
  var RAW_BUNDLE = 'https://raw.githubusercontent.com/Scuffed-VRChat/baloneys.github.io/refs/heads/main/scuffed_perms/roles/all.txt';
  var REPO_DIR = 'https://github.com/Scuffed-VRChat/baloneys.github.io/tree/main/scuffed_perms/roles';
  var MOD_TOKEN_KEY = 'balcade-mod-token';   // same key /moderation.html uses for the master session (this tab only)
  var ADMIN_LEVEL = 3;
  var LEVEL_NAMES = { 3: 'Admin', 4: 'Developer', 5: 'Master' };

  // Friendly names, in the order the world checks them (top wins). Unknown files show after these.
  var KNOWN = [
    ['devs.txt', 'Dev'], ['com lead', 'Com Lead'], ['mod.txt', 'Mod'], ['testers.txt', 'Tester'],
    ['groupowners.txt', 'Group Owner'], ['djs.txt', 'Event DJ'], ['premiums.txt', 'Prem']
  ];

  var client = null;     // the Supabase client games-social.js signed in with
  var modToken = null;
  var me = null;         // { level, actor } once let in
  var roles = [];        // { file, label, sha, entries: [{text, comment}], added: {}, removed: {}, note }
  var busy = false;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function status(id, text, kind) { var s = $(id); s.textContent = text || ''; s.className = 'perms-status' + (kind ? ' is-' + kind : ''); }
  function lower(s) { return String(s).toLowerCase(); }
  function show(id, on) { $(id).classList.toggle('hidden', !on); }
  function readModToken() { try { return sessionStorage.getItem(MOD_TOKEN_KEY); } catch (e) { return null; } }
  function storeModToken(t) { try { if (t) sessionStorage.setItem(MOD_TOKEN_KEY, t); else sessionStorage.removeItem(MOD_TOKEN_KEY); } catch (e) { /* tab-only anyway */ } }

  /* ---------- the Worker ---------- */

  function accessToken() {
    if (!client) return Promise.resolve('');
    return client.auth.getSession().then(function (r) { return r.data && r.data.session ? r.data.session.access_token : ''; });
  }

  function worker(path, body) {
    return accessToken().then(function (at) {
      var headers = {};
      if (at) headers.Authorization = 'Bearer ' + at;
      if (modToken) headers['X-Mod-Token'] = modToken;
      if (body) headers['Content-Type'] = 'application/json';
      return fetch(WORKER + path, { method: body ? 'POST' : 'GET', headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) { var e = new Error(data.error || 'The perms server answered ' + r.status); e.status = r.status; throw e; }
        return data;
      });
    }, function (e) {
      if (e && e.status) throw e;
      throw new Error('Couldn\'t reach the perms server. Check your connection and try again.');
    });
  }

  /* ---------- access gate ---------- */

  function gate(state, text) {
    // state: checking | noaccount | denied | admin | offline
    show('gateChecking', state === 'checking');
    show('gateNoAccount', state === 'noaccount');
    show('gateDenied', state === 'denied');
    show('masterPanel', state === 'noaccount' || state === 'denied');
    show('adminBar', state === 'admin');
    show('editor', state === 'admin');
    show('worldPanel', state === 'admin');
    show('recheckRow', state === 'noaccount' || state === 'denied' || state === 'offline');
    if (state !== 'admin') { $('roleGrid').textContent = ''; show('saveBar', false); }
    status('gateStatus', text || '', state === 'offline' ? 'bad' : '');
    show('gateStatus', !!text);   // after status(), which resets the class list
  }

  function waitForClient(timeoutMs) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var c = window.GameSocial && window.GameSocial.client && window.GameSocial.client();
        if (c) return resolve(c);
        if (Date.now() - t0 > timeoutMs) return resolve(null);
        setTimeout(poll, 150);
      })();
    });
  }

  function checkAccess() {
    gate('checking');
    return client.rpc('mod_me', { token: modToken }).then(function (r) {
      if (r.error) throw r.error;
      var level = r.data && r.data.level || 0;
      if (level >= ADMIN_LEVEL) {
        me = { level: level, actor: r.data.actor };
        $('whoAmI').textContent = 'Signed in as ' + me.actor + ' · ' + (LEVEL_NAMES[level] || 'Admin');
        show('masterLogout', !!modToken);
        gate('admin');
        // Back in with unsaved edits (e.g. after "Check again"): show them rather than reload over them.
        if (changedRoles().length) { render(); status('loadStatus', 'Your unsaved changes are still here.'); return; }
        return load();
      }
      me = null;
      if (modToken) { modToken = null; storeModToken(null); }   // an expired master session
      var p = window.GameSocial && window.GameSocial.me && window.GameSocial.me();
      if (!p) return gate('noaccount');
      $('deniedWho').textContent = 'You\'re signed in as ' + p.name + (r.data && r.data.actor ? ' (' + r.data.actor + ')' : '') + '.';
      gate('denied');
    }).catch(function (e) {
      gate('offline', 'Couldn\'t check your access: ' + (e.message || e));
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
    return {
      file: name, label: label, rank: rank, sha: sha,
      entries: splitLines(text).map(function (l) { var t = l.trim(); return { text: t, comment: t.charAt(0) === '#' || t.indexOf('//') === 0 }; }),
      added: {}, removed: {}, note: '', noteBad: false
    };
  }

  function names(role) { return role.entries.filter(function (e) { return !e.comment; }).map(function (e) { return e.text; }); }
  function hasName(role, name) { return names(role).some(function (n) { return lower(n) === lower(name); }); }
  function finalNames(role) {
    var out = names(role).filter(function (n) { return !role.removed[lower(n)]; });
    Object.keys(role.added).forEach(function (k) { out.push(role.added[k]); });
    return out;
  }
  function isChanged(role) { return Object.keys(role.added).length > 0 || Object.keys(role.removed).length > 0; }
  function changedRoles() { return roles.filter(isChanged); }

  /* ---------- editing ---------- */

  function problemWith(name) {
    if (!name) return 'Type a display name first.';
    if (name.length > 64) return 'That name is too long (64 characters at most).';
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
    return true;
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
    var b = el('button', null, kind === 'removed' ? '↺' : '×');
    b.type = 'button';
    b.title = kind === 'removed' ? 'Keep ' + name : kind === 'added' ? 'Don\'t add ' + name : 'Remove ' + name;
    b.setAttribute('aria-label', b.title);
    b.addEventListener('click', function () { toggleRemove(role, name); });
    c.appendChild(b);
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
      var count = finalNames(role).length;
      head.appendChild(el('div', 'perms-role-count', count + (count === 1 ? ' player' : ' players')));
      card.appendChild(head);

      var chips = el('div', 'perms-chips');
      names(role).forEach(function (n) { chips.appendChild(chip(role, n, role.removed[lower(n)] ? 'removed' : '', query)); });
      Object.keys(role.added).forEach(function (k) { chips.appendChild(chip(role, role.added[k], 'added', query)); });
      if (!chips.childNodes.length) chips.appendChild(el('span', 'perms-empty', 'Nobody yet'));
      card.appendChild(chips);

      var form = el('form', 'perms-row');
      var input = el('input', 'perms-input');
      input.placeholder = 'Add a VRChat display name';
      input.setAttribute('aria-label', 'Add a player to ' + role.label);
      input.setAttribute('data-role-input', role.file);
      input.autocomplete = 'off';
      var add = el('button', 'btn btn-sm btn-primary', 'Add'); add.type = 'submit';
      form.appendChild(input); form.appendChild(add);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var keep = input.value;
        var ok = addNames(role, keep);
        var box = document.querySelector('[data-role-input="' + CSS.escape(role.file) + '"]');
        if (box) { if (!ok) box.value = keep; box.focus(); }   // a bad name stays in the box to fix
      });
      card.appendChild(form);
      card.appendChild(el('p', 'perms-status' + (role.note && role.noteBad ? ' is-bad' : ''), role.note || ''));
      if (isChanged(role)) {
        var undo = el('button', 'btn btn-sm btn-outline', 'Undo changes to ' + role.label); undo.type = 'button';
        undo.addEventListener('click', function () { role.added = {}; role.removed = {}; role.note = ''; render(); });
        card.appendChild(undo);
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
    show('saveBar', changed.length > 0);
    $('saveSummary').textContent = changed.length ? summary().join(' · ') : '';
  }

  /* ---------- load / save ---------- */

  function load(doneMessage) {
    if (busy || !me) return Promise.resolve();
    if (typeof doneMessage !== 'string') doneMessage = '';
    if (!doneMessage && changedRoles().length && !confirm('Reloading throws away your unsaved changes. Reload anyway?')) return Promise.resolve();
    busy = true;
    status('loadStatus', 'Loading the lists…');
    return worker('/lists').then(function (data) {
      roles = (data.files || []).map(function (f) { return makeRole(f.name, f.sha, f.text); });
      roles.sort(function (a, b) { return a.rank - b.rank || (lower(a.file) < lower(b.file) ? -1 : 1); });
      status('loadStatus', doneMessage || 'Loaded ' + roles.length + ' role lists.', 'good');
      render();
    }).catch(function (e) {
      if (e.status === 401 || e.status === 403) { me = null; checkAccess(); return; }
      status('loadStatus', 'Couldn\'t load the lists: ' + e.message, 'bad');
    }).then(function () { busy = false; });
  }

  function save() {
    if (busy || !me) return;
    var changed = changedRoles();
    if (!changed.length) return;
    busy = true;
    $('saveBtn').disabled = true;
    status('saveStatus', 'Saving…');
    var changes = {};
    changed.forEach(function (r) { changes[r.file] = { sha: r.sha, names: finalNames(r) }; });
    worker('/save', { changes: changes }).then(function (res) {
      busy = false;
      $('saveBtn').disabled = false;
      status('saveStatus', '');
      roles.forEach(function (r) { r.added = {}; r.removed = {}; r.note = ''; });
      return load(res.commit
        ? 'Saved (' + res.commit.slice(0, 7) + '). The world picks it up at its next role refresh, usually within 5–10 minutes.'
        : 'Nothing to save: the lists already matched.');
    }).catch(function (e) {
      busy = false;
      $('saveBtn').disabled = false;
      if (e.status === 401 || e.status === 403) { status('saveStatus', 'Not saved: ' + e.message, 'bad'); checkAccess(); return; }
      status('saveStatus', 'Not saved: ' + e.message, 'bad');
    });
  }

  /* ---------- boot ---------- */

  function boot() {
    $('bundleUrl').textContent = RAW_BUNDLE;
    $('repoLink').href = REPO_DIR;
    $('reload').addEventListener('click', function () { load(); });
    $('search').addEventListener('input', render);
    $('saveBtn').addEventListener('click', save);
    $('discard').addEventListener('click', function () {
      if (!confirm('Throw away every unsaved change?')) return;
      roles.forEach(function (r) { r.added = {}; r.removed = {}; r.note = ''; });
      render();
    });
    $('copyUrl').addEventListener('click', function () {
      navigator.clipboard.writeText(RAW_BUNDLE).then(function () { $('copyUrl').textContent = 'Copied'; setTimeout(function () { $('copyUrl').textContent = 'Copy'; }, 1500); });
    });
    $('masterLogin').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!client) return;
      status('masterStatus', 'Checking…');
      client.rpc('mod_master_login', { username: $('mUser').value, password: $('mPass').value }).then(function (r) {
        $('mPass').value = '';
        if (r.error) return status('masterStatus', r.error.message, 'bad');
        modToken = r.data; storeModToken(modToken);
        status('masterStatus', '');
        checkAccess();
      });
    });
    $('masterLogout').addEventListener('click', function () {
      if (changedRoles().length && !confirm('Logging out throws away your unsaved changes. Log out anyway?')) return;
      var t = modToken;
      modToken = null; storeModToken(null);
      (t && client ? client.rpc('mod_logout', { token: t }) : Promise.resolve()).then(checkAccess);
    });
    $('recheck').addEventListener('click', checkAccess);
    window.addEventListener('beforeunload', function (e) { if (changedRoles().length) { e.preventDefault(); e.returnValue = ''; } });

    modToken = readModToken();
    gate('checking');
    if (!window.GameSocial || !window.GameSocial.enabled) return gate('offline', 'The site\'s player accounts are switched off on this copy of the site.');
    waitForClient(15000).then(function (c) {
      if (!c) return gate('offline', 'Couldn\'t reach the player account service. Reload to try again.');
      client = c;
      // A player who has a profile is fully signed in once games-social.js says so; give it a moment.
      // If the profile turns up after the fallback check, check again (unless we're already in).
      var checked = false;
      window.GameSocial.ready(function () { checked = true; if (!me) checkAccess(); });
      setTimeout(function () { if (!checked) { checked = true; checkAccess(); } }, 2500);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
