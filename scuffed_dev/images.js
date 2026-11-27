// scuffed_dev/images.js: the world images page (kanaris-beans.com/scuffed_dev/images/).
//
// Everything the Scuffed world downloads as a picture lives in /scuffed/images/<folder>/<name>.png on the site.
// What you can do depends on your level on the moderation panel:
//
//   moderator  look around (every image, every pending suggestion, the history)
//   admin      suggest images: a replacement for a slot, or a new one. Nothing reaches the site until...
//   developer  ...a developer approves it. Developers also add, replace, rename and delete directly.
//
// Every picture is converted in a background worker before it leaves the browser (any format the browser can
// read, to PNG, longest side 512px, or an A4 poster 362x512). A progress pop-up shows each file's stage, so a
// big photo never looks like a frozen page. The scuffed-perms Worker checks levels and PNGs again and commits:
// direct changes to main, suggestions to a separate branch GitHub Pages doesn't serve.
//
// The console on the right is the audit log: every commit for the folder and for suggestions (who, when, what),
// plus what this tab is doing. Signing in and the staff gate come from /scuffed_dev/core.js; the Worker is the lock.
(function () {
  'use strict';

  var SD = window.ScuffedDev;
  var $ = SD.$, el = SD.el, show = SD.show;

  var WORKER = 'https://scuffed-perms.seanboyle20126.workers.dev';
  var SITE = 'https://kanaris-beans.com/scuffed/images/';            // what the world downloads
  var RAW = 'https://raw.githubusercontent.com/Scuffed-VRChat/baloneys.github.io/';
  var DIR = 'scuffed/images/';
  var COMMIT_URL = 'https://github.com/Scuffed-VRChat/baloneys.github.io/commit/';
  var MOD_TOKEN_KEY = 'balcade-mod-token';
  var POLL_MS = 30000;
  var BATCH_BYTES = 4 * 1024 * 1024;   // per request to the Worker (it refuses more than 10 MB)
  var BATCH_COUNT = 8;
  var POPUP_AFTER_MS = 0;              // the progress pop-up opens as soon as a conversion starts
  var SLOW_AFTER_MS = 3000;
  var NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
  var SUGG = '@suggestions';           // the folder bar's Suggestions tab

  // Folders the world already uses, in this order; any other folder shows after them.
  var KNOWN = {
    posters: { label: 'Posters', shape: 'a4p', note: 'A4 poster slots, numbered. The cropper starts on A4 portrait here.' },
    players: { label: 'Players', note: 'Player and premium member photos.' },
    scuffed: { label: 'Scuffed', note: 'Scuffed’s own pictures and logos.' },
    events: { label: 'Events', note: 'Event and partner group logos.' },
    ads: { label: 'Ads', note: 'Advertisement boards and wall art.' }
  };
  var ORDER = Object.keys(KNOWN);
  var STAGES = {   // how far along a file is at each stage (the overall bar averages these)
    queued: [0, 'Waiting'], reading: [0.08, 'Reading'], decoded: [0.35, 'Resizing'], resized: [0.6, 'Encoding PNG'],
    converted: [0.82, 'Converted'], ready: [0.85, 'Ready to send'], uploading: [0.92, 'Uploading'],
    saved: [1, 'Saved'], sent: [1, 'Sent for approval'], failed: [1, 'Failed'], cancelled: [1, 'Cancelled']
  };

  var S = {
    loaded: false,
    head: null,
    files: {},          // path -> { path, folder, name, sha, size }
    manifest: {},       // path -> { w, h, from, by, at, placeholder, source, approvedBy, note }
    thumbs: {},         // path -> { sha, url }  (keeps a picture's URL while its sha doesn't change)
    suggestions: [],    // [{ id, path, sha, file, blob, w, h, from, note, by, at }]
    suggestHead: null,
    suggFilter: null,   // show only the suggestions for this path
    localFolders: [],
    folder: null,
    search: '',
    selected: {},
    pending: [],        // files being converted / sent: { id, path, folder, name, replaceSha, file, state, url, error }
    commits: [],
    local: [],
    logFilter: 'all'
  };
  var job = null;       // the current batch: { items, mode: 'save'|'suggest', started, popup, cancelled, phase }
  var saveChain = Promise.resolve();
  var timer = 0;
  var seq = 0;

  /* ---------- small helpers ---------- */

  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function folderOf(p) { return p.split('/')[0]; }
  function nameOf(p) { return p.split('/').slice(1).join('/'); }
  function label(f) { return f === SUGG ? 'Suggestions' : (KNOWN[f] && KNOWN[f].label) || f.charAt(0).toUpperCase() + f.slice(1).replace(/[-_]/g, ' '); }
  function natural(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function slug(s) {
    return String(s || '').replace(/\.[a-z0-9]{2,5}$/i, '').toLowerCase().replace(/&/g, ' and ')
      .replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 60);
  }
  function canEdit() { return SD.level() >= 4; }
  function canSuggest() { return SD.level() >= 3; }
  function canAdd() { return canSuggest(); }   // developers save, admins suggest
  function myName() { return (SD.me() && SD.me().name) || ''; }
  function folders() {
    var set = {};
    Object.keys(S.files).forEach(function (p) { set[folderOf(p)] = true; });
    S.suggestions.forEach(function (s) { set[folderOf(s.path)] = true; });
    S.localFolders.forEach(function (f) { set[f] = true; });
    var extra = Object.keys(set).filter(function (f) { return !KNOWN[f]; }).sort(natural);
    return ORDER.filter(function (f) { return set[f]; }).concat(extra);
  }
  function inFolder(f) { return Object.keys(S.files).filter(function (p) { return folderOf(p) === f; }).sort(function (a, b) { return natural(nameOf(a), nameOf(b)); }); }
  function suggFor(p) { return S.suggestions.filter(function (s) { return s.path === p; }); }
  function thumb(p) { var t = S.thumbs[p]; return t ? t.url : ''; }
  function suggThumb(s) { return S.suggestHead ? RAW + S.suggestHead + '/' + s.file : ''; }
  function worldUrl(p) { return SITE + p; }
  // The cropper's last shape / resolution / fit for a folder, so the next upload starts the same way.
  function prefsFor(f) {
    try { var v = JSON.parse(localStorage.getItem('scd-images-crop:' + f) || 'null'); if (v && v.shape) return v; } catch (e) { /* private mode */ }
    return { shape: (KNOWN[f] && KNOWN[f].shape) || 'original', size: 512, pad: false };
  }
  function setPrefs(f, v) { try { localStorage.setItem('scd-images-crop:' + f, JSON.stringify(v)); } catch (e) { /* fine */ } }
  function isPng(blob) {
    return blob.slice(0, 8).arrayBuffer().then(function (b) {
      var u = new Uint8Array(b), sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      return u.length === 8 && sig.every(function (v, i) { return u[i] === v; });
    });
  }

  /* ---------- the console ---------- */

  function log(kind, text) {
    S.local.unshift({ at: new Date().toISOString(), kind: kind, text: text });
    if (S.local.length > 150) S.local.length = 150;
    renderLog();
  }

  function parseCommit(c) {
    var lines = String(c.message || '').replace(/\r/g, '').split('\n');
    var title = lines[0].replace(/^Scuffed images:\s*/i, '');
    var by = '';
    var ops = [];
    var notes = [];
    lines.slice(1).forEach(function (l) {
      var m = /^(Saved|Approved|Suggested|Rejected|Withdrawn) by (.+?)(?:;.*| from .*)?$/.exec(l);
      if (m) { by = m[2]; return; }
      var n = /^(Note|Reason): (.+)$/.exec(l);
      if (n) { notes.push(n[1] + ': ' + n[2]); return; }
      var o = /^([+~\->?=x]) (.+)$/.exec(l);
      if (o) ops.push({ sym: o[1], text: o[2] });
    });
    return { sha: c.sha, at: c.date, title: title, by: by || 'someone', ops: ops, notes: notes, sugg: c.branch === 'suggestions' };
  }

  function renderLog() {
    var ol = $('imLog');
    if (!ol) return;
    var rows = [];
    if (S.logFilter !== 'saves') S.local.forEach(function (l) { rows.push({ t: SD.time(l.at), local: l }); });
    if (S.logFilter !== 'here') S.commits.forEach(function (c) { rows.push({ t: SD.time(c.at), commit: c }); });
    rows.sort(function (a, b) { return b.t - a.t; });
    ol.textContent = '';
    if (!rows.length) { ol.appendChild(el('li', 'im-log-empty', S.loaded ? 'Nothing yet.' : 'Loading the history…')); return; }
    var OPS = { '+': 'add', '~': 'rep', '-': 'del', '>': 'mov', '?': 'sug', '=': 'ok', 'x': 'no' };
    rows.slice(0, 120).forEach(function (r) {
      var li = el('li', 'im-log-row');
      var when = el('time', 'im-log-time', SD.ago(r.local ? r.local.at : r.commit.at));
      when.title = SD.fullDate(r.local ? r.local.at : r.commit.at);
      if (r.local) {
        li.classList.add('is-' + r.local.kind);
        var head = el('div', 'im-log-head');
        head.appendChild(el('span', 'im-log-tag', r.local.kind === 'work' ? '…' : r.local.kind === 'bad' ? '!' : r.local.kind === 'good' ? '✓' : '·'));
        head.appendChild(el('span', 'im-log-text', r.local.text));
        head.appendChild(when);
        li.appendChild(head);
      } else {
        var c = r.commit;
        li.classList.add(c.sugg ? 'is-sugg' : 'is-save');
        var h = el('div', 'im-log-head');
        h.appendChild(el('span', 'im-log-tag', c.sugg ? '◇' : '◆'));
        var t = el('span', 'im-log-text');
        t.appendChild(el('strong', null, c.by));
        t.appendChild(document.createTextNode(' ' + c.title));
        h.appendChild(t);
        h.appendChild(when);
        li.appendChild(h);
        if (c.ops.length || c.notes.length) {
          var ul = el('ul', 'im-log-ops');
          c.ops.slice(0, 6).forEach(function (o) {
            var oi = el('li', 'op-' + OPS[o.sym]);
            oi.appendChild(el('b', null, o.sym === '=' ? '✓' : o.sym === 'x' ? '✕' : o.sym));
            oi.appendChild(document.createTextNode(' ' + o.text));
            ul.appendChild(oi);
          });
          if (c.ops.length > 6) ul.appendChild(el('li', 'op-more', '… and ' + (c.ops.length - 6) + ' more'));
          c.notes.forEach(function (n) { ul.appendChild(el('li', 'op-note', n)); });
          li.appendChild(ul);
        }
        var a = el('a', 'im-log-sha', c.sha.slice(0, 7));
        a.href = COMMIT_URL + c.sha; a.target = '_blank'; a.rel = 'noopener';
        a.title = 'Open this commit on GitHub';
        li.appendChild(a);
      }
      ol.appendChild(li);
    });
  }

  /* ---------- the Worker ---------- */

  function accessToken() {
    var c = window.GameSocial && window.GameSocial.client && window.GameSocial.client();
    if (!c) return Promise.resolve('');
    return c.auth.getSession().then(function (r) { return r.data && r.data.session ? r.data.session.access_token : ''; }, function () { return ''; });
  }

  function worker(path, body) {
    return accessToken().then(function (at) {
      var headers = {};
      var mt = null;
      try { mt = sessionStorage.getItem(MOD_TOKEN_KEY); } catch (e) { /* tab only */ }
      if (at) headers.Authorization = 'Bearer ' + at;
      if (mt) headers['X-Mod-Token'] = mt;
      if (body) headers['Content-Type'] = 'application/json';
      return fetch(WORKER + path, { method: body ? 'POST' : 'GET', headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) { var e = new Error(data.error || 'The image server answered ' + r.status); e.status = r.status; e.code = data.code; throw e; }
        return data;
      });
    }, function (e) {
      if (e && e.status) throw e;
      throw new Error('Couldn\'t reach the image server. Check your connection and try again.');
    });
  }

  /* ---------- converting: any image -> PNG, in a background worker ---------- */

  // Where the picture goes on the output canvas, from the cropper's choice o = { crop, ratio, size, pad }:
  //   crop {x,y,w,h}  cut exactly that part (source px)      pad + ratio  whole picture, padded to that shape
  //   ratio only      the centred part with that shape        nothing     the whole picture
  // The longest side of the result is o.size (Unity max size: 512 or less). Pure: also runs in the worker.
  function plan(sw, sh, o) {
    o = o || {};
    var N = Math.max(1, Math.min(512, o.size || 512)), r = o.ratio, c = o.crop;
    if (o.pad && r) {
      var W = r >= 1 ? N : Math.max(1, Math.round(N * r)), H = r >= 1 ? Math.max(1, Math.round(N / r)) : N;
      var s = Math.min(W / sw, H / sh), dw = Math.max(1, Math.round(sw * s)), dh = Math.max(1, Math.round(sh * s));
      return { w: W, h: H, sx: 0, sy: 0, sw: sw, sh: sh, dx: Math.round((W - dw) / 2), dy: Math.round((H - dh) / 2), dw: dw, dh: dh };
    }
    if (!c && r) {
      if (sw / sh > r) { var cw0 = sh * r; c = { x: (sw - cw0) / 2, y: 0, w: cw0, h: sh }; }
      else { var ch0 = sw / r; c = { x: 0, y: (sh - ch0) / 2, w: sw, h: ch0 }; }
    }
    if (!c) c = { x: 0, y: 0, w: sw, h: sh };
    var x = Math.max(0, Math.min(c.x, sw - 1)), y = Math.max(0, Math.min(c.y, sh - 1));
    var cw = Math.max(1, Math.min(c.w, sw - x)), ch = Math.max(1, Math.min(c.h, sh - y));
    var k = N / Math.max(cw, ch), w = Math.max(1, Math.round(cw * k)), h = Math.max(1, Math.round(ch * k));
    return { w: w, h: h, sx: x, sy: y, sw: cw, sh: ch, dx: 0, dy: 0, dw: w, dh: h };
  }

  // Halves big pictures a step at a time before the last draw, so a 4K photo doesn't come out jagged. Pure.
  function draw(make, img, p) {
    var cur = img, cx = p.sx, cy = p.sy, cw = p.sw, ch = p.sh;
    while (cw > p.dw * 2 && ch > p.dh * 2) {
      var nw = Math.max(1, Math.round(cw / 2)), nh = Math.max(1, Math.round(ch / 2));
      var c = make(nw, nh), g = c.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(cur, cx, cy, cw, ch, 0, 0, nw, nh);
      cur = c; cx = 0; cy = 0; cw = nw; ch = nh;
    }
    var out = make(p.w, p.h), o = out.getContext('2d');
    o.imageSmoothingEnabled = true; o.imageSmoothingQuality = 'high';
    o.drawImage(cur, cx, cy, cw, ch, p.dx, p.dy, p.dw, p.dh);
    return out;
  }

  function workerMain() {
    self.onmessage = function (e) {
      var d = e.data;
      createImageBitmap(d.file).then(function (bmp) {
        self.postMessage({ id: d.id, stage: 'decoded' });
        var p = plan(bmp.width, bmp.height, d.opts);
        var out = draw(function (w, h) { return new OffscreenCanvas(w, h); }, bmp, p);
        var sw = bmp.width, sh = bmp.height;
        bmp.close();
        self.postMessage({ id: d.id, stage: 'resized' });
        return out.convertToBlob({ type: 'image/png' }).then(function (blob) {
          self.postMessage({ id: d.id, blob: blob, w: p.w, h: p.h, srcW: sw, srcH: sh });
        });
      }).catch(function (err) { self.postMessage({ id: d.id, error: String(err && err.message || err) }); });
    };
  }

  var bg = null;
  var bgWaiting = {};
  function background() {
    if (bg !== null) return bg;
    bg = false;
    try {
      if (typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') return bg;
      var src = plan.toString() + '\n' + draw.toString() + '\n(' + workerMain.toString() + ')();';
      bg = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      bg.onmessage = function (e) {
        var w = bgWaiting[e.data.id];
        if (!w) return;
        if (e.data.stage) { w.stage(e.data.stage); return; }
        delete bgWaiting[e.data.id];
        w.done(e.data);
      };
      bg.onerror = function () { bg = false; };
    } catch (e) { bg = false; }
    return bg;
  }

  // Fallback on the page itself: anything an <img> can show (SVG, or when the worker can't read the file).
  function convertHere(file, opts, stage) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        stage('decoded');
        // let the pop-up paint before the (blocking) canvas work
        setTimeout(function () {
          var sw = img.naturalWidth || 512, sh = img.naturalHeight || 512;
          var p = plan(sw, sh, opts);
          var out = draw(function (w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }, img, p);
          stage('resized');
          out.toBlob(function (blob) {
            URL.revokeObjectURL(url);
            if (!blob) return reject(new Error('the browser couldn\'t make a PNG'));
            resolve({ blob: blob, w: p.w, h: p.h, srcW: sw, srcH: sh });
          }, 'image/png');
        }, 30);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
      img.src = url;
    });
  }

  function convert(file, opts, stage) {
    var w = background();
    var first = w ? new Promise(function (resolve, reject) {
      var id = ++seq;
      bgWaiting[id] = { stage: stage, done: function (d) { if (d.error) reject(new Error(d.error)); else resolve(d); } };
      w.postMessage({ id: id, file: file, opts: opts });
    }) : Promise.reject(new Error('no worker'));
    return first.catch(function () { return convertHere(file, opts, stage); }).catch(function () {
      var ext = (/\.([a-z0-9]+)$/i.exec(file.name || '') || [])[1] || file.type || 'this';
      var hint = /heic|heif/i.test(ext) ? ' (iPhone photos: Safari can read these, or save the photo as JPG first)' :
        /psd|tiff?|raw|cr2|nef|dng/i.test(ext) ? ' (export it as PNG or JPG first)' : '';
      throw new Error('This browser can\'t read .' + String(ext).toLowerCase() + ' files' + hint + '.');
    });
  }

  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).replace(/^data:[^,]*,/, '')); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  /* ---------- loading ---------- */

  function applyList(data) {
    S.head = data.head;
    S.manifest = data.manifest || {};
    var files = {};
    (data.files || []).forEach(function (f) {
      if (!/\.png$/i.test(f.path) || f.path.indexOf('/') < 0) return;
      files[f.path] = { path: f.path, folder: folderOf(f.path), name: nameOf(f.path), sha: f.sha, size: f.size };
      var t = S.thumbs[f.path];
      if (!t || t.sha !== f.sha) S.thumbs[f.path] = { sha: f.sha, url: RAW + data.head + '/' + DIR + f.path };
    });
    S.files = files;
    S.suggestions = (data.suggestions || []).slice().sort(function (a, b) { return SD.time(a.at) - SD.time(b.at); });
    S.suggestHead = data.suggestHead || null;
    Object.keys(S.selected).forEach(function (p) { if (!files[p]) delete S.selected[p]; });
    S.localFolders = S.localFolders.filter(function (f) { return !inFolder(f).length; });
    S.loaded = true;
  }

  function load(quiet) {
    return Promise.all([worker('/images'), worker('/images/log').catch(function () { return null; })]).then(function (r) {
      var before = S.head, beforeSugg = S.suggestions.length;
      applyList(r[0]);
      if (r[1]) S.commits = (r[1].commits || []).map(parseCommit);
      if (!S.folder || (S.folder !== SUGG && folders().indexOf(S.folder) < 0)) pickFolder(fromHash() || folders()[0] || 'posters', true);
      SD.status('imStatus', '');
      show('imStatus', false);
      if (!quiet) {
        log('info', 'Loaded ' + plural(Object.keys(S.files).length, 'image') + ' in ' + plural(folders().length, 'folder') + '.');
        if (S.suggestions.length) log('info', plural(S.suggestions.length, 'suggestion') + ' waiting for a developer.');
      } else if (before && before !== S.head) log('info', 'Someone saved changes; the page is up to date.');
      else if (S.suggestions.length > beforeSugg) log('info', 'New suggestion' + (S.suggestions.length - beforeSugg === 1 ? '' : 's') + ' came in.');
      render();
    }).catch(function (e) {
      SD.status('imStatus', 'Couldn\'t load the images: ' + SD.errText(e), 'bad');
      show('imStatus', true);
      if (!quiet) log('bad', 'Couldn\'t load the images: ' + SD.errText(e));
    });
  }

  /* ---------- rendering ---------- */

  function fromHash() { var m = /folder=([a-z0-9_@-]+)/.exec(location.hash); return m ? decodeURIComponent(m[1]) : null; }

  function pickFolder(f, silent) {
    S.folder = f;
    S.selected = {};
    if (f !== SUGG) S.suggFilter = null;
    if (!silent || !fromHash()) history.replaceState(null, '', '#folder=' + f);
    if (!silent) render();
  }

  function renderRole() {
    var box = $('imRole');
    box.textContent = '';
    var lvl = SD.level();
    var waiting = S.suggestions.length;
    var chip = el('span', 'im-role-chip is-l' + Math.min(lvl, 4), (SD.LEVEL_NAMES[lvl] || 'Staff'));
    box.appendChild(chip);
    box.appendChild(el('span', 'im-role-text', canEdit()
      ? 'Your changes go live on the site. You approve suggestions.'
      : canSuggest() ? 'Your images go to a developer for approval before they reach the site.'
      : 'View only. Admins can suggest images; developers publish them.'));
    if (waiting && S.folder !== SUGG) {
      var a = el('button', 'im-role-link' + (canEdit() ? ' is-hot' : ''), (canEdit() ? 'Review ' : 'See ') + plural(waiting, 'suggestion') + ' →');
      a.type = 'button';
      a.addEventListener('click', function () { pickFolder(SUGG); });
      box.appendChild(a);
    }
  }

  function folderTab(f, n, extraCls) {
    var b = el('button', 'im-folder' + (f === S.folder ? ' is-on' : '') + (extraCls ? ' ' + extraCls : ''));
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(f === S.folder));
    b.appendChild(el('span', null, label(f)));
    b.appendChild(el('span', 'im-folder-n', String(n)));
    b.addEventListener('click', function () { if (f === SUGG) S.suggFilter = null; pickFolder(f); });
    return b;
  }

  function renderFolders() {
    var box = $('imFolders');
    box.textContent = '';
    folders().forEach(function (f) {
      var b = folderTab(f, inFolder(f).length);
      if (canAdd()) {
        b.addEventListener('dragover', function (e) { if (hasFiles(e)) { e.preventDefault(); b.classList.add('is-drop'); } });
        b.addEventListener('dragleave', function () { b.classList.remove('is-drop'); });
        b.addEventListener('drop', function (e) {
          b.classList.remove('is-drop');
          if (!hasFiles(e)) return;
          e.preventDefault(); e.stopPropagation();
          endDrag();
          pickFolder(f);
          addFiles(e.dataTransfer.files, { folder: f });
        });
      }
      box.appendChild(b);
    });
    if (canAdd()) {
      var add = el('button', 'im-folder im-folder-new', '+ New folder');
      add.type = 'button';
      add.addEventListener('click', function () {
        var name = slug(window.prompt('Name the new folder (lowercase letters, numbers, - and _):', '') || '');
        if (!name) return;
        if (folders().indexOf(name) < 0) S.localFolders.push(name);
        log('info', 'New folder "' + name + '". It is saved with its first image' + (canEdit() ? '.' : ' once a developer approves it.'));
        pickFolder(name);
      });
      box.appendChild(add);
    }
    var sep = el('span', 'im-folder-sep');
    sep.setAttribute('aria-hidden', 'true');
    box.appendChild(sep);
    box.appendChild(folderTab(SUGG, S.suggestions.length, 'im-folder-sugg' + (S.suggestions.length && canEdit() ? ' is-hot' : '')));
  }

  function renderToolbar() {
    var inSugg = S.folder === SUGG;
    show('imUpload', canAdd() && !inSugg);
    $('imUploadText').textContent = canEdit() ? 'Upload' : 'Suggest images';
    $('imSearch').placeholder = inSugg ? 'Find a suggestion' : 'Find an image';
    var note = KNOWN[S.folder] && KNOWN[S.folder].note;
    var how = !canAdd() ? 'View only'
      : canEdit() ? 'Drop images anywhere to add them here · drop onto a picture to replace it · or paste with Ctrl+V'
      : 'Drop images anywhere to suggest them for this folder · drop onto a picture to suggest a replacement · or paste with Ctrl+V';
    $('imHint').textContent = inSugg
      ? (canEdit() ? 'Approve to put a picture on the site, reject to drop it. Each one shows what it would replace.' : 'Pictures waiting for a developer. Nothing here is on the site yet.')
      : (note ? note + ' · ' : '') + how;
  }

  function card(p) {
    var f = S.files[p];
    var meta = S.manifest[p] || {};
    var c = el('article', 'im-card');
    c.setAttribute('data-path', p);
    if (S.selected[p]) c.classList.add('is-picked');

    var th = el('button', 'im-thumb im-checker');
    th.type = 'button';
    th.title = 'Open ' + f.name;
    var img = el('img');
    img.loading = 'lazy'; img.decoding = 'async'; img.alt = f.name;
    img.src = thumb(p);
    th.appendChild(img);
    th.addEventListener('click', function () { openDialog(p); });
    c.appendChild(th);

    if (canEdit()) {
      var pick = el('label', 'im-pick');
      pick.title = 'Select';
      var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!S.selected[p];
      cb.setAttribute('aria-label', 'Select ' + f.name);
      cb.addEventListener('change', function () { if (cb.checked) S.selected[p] = true; else delete S.selected[p]; c.classList.toggle('is-picked', cb.checked); renderSelbar(); });
      pick.appendChild(cb);
      c.appendChild(pick);
    }

    if (meta.placeholder) c.appendChild(el('span', 'im-badge', 'Placeholder'));
    var waiting = suggFor(p).length;
    if (waiting) {
      var sb = el('button', 'im-badge-sugg', plural(waiting, 'suggestion'));
      sb.type = 'button';
      sb.title = 'See what was suggested for ' + f.name;
      sb.addEventListener('click', function (e) { e.stopPropagation(); S.suggFilter = p; pickFolder(SUGG); });
      c.appendChild(sb);
    }

    var info = el('div', 'im-card-meta');
    info.appendChild(el('strong', null, f.name));
    info.appendChild(el('span', null, (meta.w ? meta.w + '×' + meta.h + ' · ' : '') + kb(f.size)));
    c.appendChild(info);

    var acts = el('div', 'im-card-actions');
    if (canAdd()) acts.appendChild(iconBtn(canEdit() ? 'Replace' : 'Suggest a replacement', 'M4 4v6h6M20 20v-6h-6M5.6 15A7 7 0 0 0 18.9 15.4M18.4 9A7 7 0 0 0 5.1 8.6', function () { pickFile(p); }));
    acts.appendChild(iconBtn('Copy world URL', 'M9 9h10v10H9zM5 15V5h10', function () { copy(worldUrl(p)); }));
    if (canEdit()) acts.appendChild(iconBtn('Delete', 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', function () { removePaths([p]); }, 'im-danger-text'));
    c.appendChild(acts);
    return c;
  }

  function iconBtn(text, d, fn, cls) {
    var b = el('button', 'im-icon' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.title = text;
    b.setAttribute('aria-label', text);
    b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
    return b;
  }

  function pendingCard(item) {
    var c = el('article', 'im-card is-pending is-' + item.state);
    var th = el('div', 'im-thumb im-checker');
    if (item.url) { var img = el('img'); img.src = item.url; img.alt = ''; th.appendChild(img); }
    var veil = el('div', 'im-veil');
    veil.appendChild(el('span', 'im-spin'));
    veil.appendChild(el('span', null, STAGES[item.state][1] + (item.state === 'failed' || item.state === 'cancelled' ? '' : '…')));
    if (item.mode === 'suggest') veil.appendChild(el('span', 'im-veil-sub', 'suggestion'));
    th.appendChild(veil);
    c.appendChild(th);
    var info = el('div', 'im-card-meta');
    info.appendChild(el('strong', null, item.name));
    info.appendChild(el('span', null, item.error || (item.w ? item.w + '×' + item.h + ' · from ' + item.file.name : 'from ' + item.file.name)));
    c.appendChild(info);
    if (item.state === 'failed' || item.state === 'cancelled') {
      var x = iconBtn('Dismiss', 'M18 6L6 18M6 6l12 12', function () { S.pending = S.pending.filter(function (q) { return q !== item; }); renderGrid(); });
      x.classList.add('im-dismiss');
      c.appendChild(x);
    }
    return c;
  }

  function suggCard(s) {
    var c = el('article', 'im-sugg');
    var mine = s.by === myName();
    var pair = el('div', 'im-sugg-pair');
    var before = el('div', 'im-sugg-side');
    before.appendChild(el('span', 'im-sugg-cap', S.files[s.path] ? 'Now on the site' : 'New slot'));
    var bt = el('div', 'im-thumb im-checker');
    if (S.files[s.path]) { var bi = el('img'); bi.src = thumb(s.path); bi.alt = 'Current ' + s.path; bt.appendChild(bi); }
    else bt.appendChild(el('span', 'im-sugg-empty', '+'));
    before.appendChild(bt);
    pair.appendChild(before);
    pair.appendChild(el('span', 'im-sugg-arrow', '→'));
    var after = el('div', 'im-sugg-side');
    after.appendChild(el('span', 'im-sugg-cap is-new', 'Suggested'));
    var at = el('a', 'im-thumb im-checker');
    at.href = suggThumb(s); at.target = '_blank'; at.rel = 'noopener'; at.title = 'Open full size';
    var ai = el('img'); ai.src = suggThumb(s); ai.alt = 'Suggested ' + s.path; ai.loading = 'lazy';
    at.appendChild(ai);
    after.appendChild(at);
    pair.appendChild(after);
    c.appendChild(pair);

    var info = el('div', 'im-sugg-info');
    var top = el('div', 'im-sugg-top');
    top.appendChild(el('strong', null, s.path));
    top.appendChild(el('span', 'db-tag ' + (s.sha ? 'is-task' : 'is-suggestion'), s.sha ? 'Replacement' : 'New image'));
    var changed = (S.files[s.path] ? S.files[s.path].sha : null) !== s.sha;
    if (changed) top.appendChild(el('span', 'db-tag is-high', 'Slot changed since'));
    info.appendChild(top);
    var who = el('p', 'im-sugg-who');
    who.appendChild(el('b', null, s.by + (mine ? ' (you)' : '')));
    var when = el('span', null, ' · ' + SD.ago(s.at));
    when.title = SD.fullDate(s.at);
    who.appendChild(when);
    who.appendChild(document.createTextNode(' · ' + s.w + '×' + s.h + (s.from ? ' · from ' + s.from : '')));
    info.appendChild(who);
    if (s.note) info.appendChild(el('p', 'im-sugg-note', '“' + s.note + '”'));
    var acts = el('div', 'im-sugg-actions');
    if (canEdit()) {
      var ok = el('button', 'btn btn-sm btn-primary', 'Approve');
      ok.type = 'button';
      ok.addEventListener('click', function () { review(s, 'approve', ok); });
      acts.appendChild(ok);
      var no = el('button', 'btn btn-sm btn-outline im-danger-text', 'Reject');
      no.type = 'button';
      no.addEventListener('click', function () { review(s, 'reject', no); });
      acts.appendChild(no);
    }
    if (mine && !canEdit()) {
      var wd = el('button', 'btn btn-sm btn-outline', 'Withdraw');
      wd.type = 'button';
      wd.addEventListener('click', function () { review(s, 'withdraw', wd); });
      acts.appendChild(wd);
    }
    if (acts.childNodes.length) info.appendChild(acts);
    c.appendChild(info);
    return c;
  }

  function renderSuggestions(grid) {
    grid.classList.add('is-sugg');
    var q = S.search.trim().toLowerCase();
    var list = S.suggestions.filter(function (s) {
      if (S.suggFilter && s.path !== S.suggFilter) return false;
      return !q || (s.path + ' ' + s.by + ' ' + (s.from || '') + ' ' + (s.note || '')).toLowerCase().indexOf(q) >= 0;
    });
    if (S.suggFilter) {
      var f = el('div', 'im-sugg-filter');
      f.appendChild(document.createTextNode('Showing suggestions for ' + S.suggFilter + ' · '));
      var all = el('button', null, 'show all');
      all.type = 'button';
      all.addEventListener('click', function () { S.suggFilter = null; renderGrid(); });
      f.appendChild(all);
      grid.appendChild(f);
    }
    list.forEach(function (s) { grid.appendChild(suggCard(s)); });
    var pend = S.pending.filter(function (it) { return it.mode === 'suggest'; });
    pend.forEach(function (it) { grid.appendChild(pendingCard(it)); });
    var empty = !list.length && !pend.length;
    show('imEmpty', empty);
    $('imEmpty').querySelector('strong').textContent = q ? 'No suggestions match “' + S.search.trim() + '”' : 'No suggestions waiting';
    $('imEmpty').querySelector('span').textContent = canSuggest() && !canEdit() ? 'Pick a folder and drop images in to suggest them.' : 'When an admin suggests an image it shows up here.';
  }

  function renderGrid() {
    var grid = $('imGrid');
    grid.textContent = '';
    grid.classList.remove('is-sugg');
    if (S.folder === SUGG) return renderSuggestions(grid);
    var q = S.search.trim().toLowerCase();
    var list = inFolder(S.folder).filter(function (p) {
      if (!q) return true;
      var m = S.manifest[p] || {};
      return (nameOf(p) + ' ' + (m.from || '') + ' ' + (m.source || '')).toLowerCase().indexOf(q) >= 0;
    });
    var pend = S.pending.filter(function (it) { return it.folder === S.folder; });
    var replacing = {};
    pend.forEach(function (it) { if (it.replaceSha && it.mode === 'save') replacing[it.path] = it; });
    list.forEach(function (p) { grid.appendChild(replacing[p] ? pendingCard(replacing[p]) : card(p)); });
    pend.forEach(function (it) { if (!replacing[it.path] || !S.files[it.path]) grid.appendChild(pendingCard(it)); });
    show('imEmpty', !grid.childNodes.length);
    $('imEmpty').querySelector('strong').textContent = q ? 'No images match “' + S.search.trim() + '”' : 'This folder is empty';
    $('imEmpty').querySelector('span').textContent = canAdd() ? 'Drop images here, or press ' + (canEdit() ? 'Upload.' : 'Suggest images.') : 'Nothing here yet.';
  }

  function renderSelbar() {
    var n = Object.keys(S.selected).length;
    show('imSelbar', n > 0 && canEdit());
    $('imSelCount').textContent = n + ' selected';
  }

  function render() {
    if (!S.loaded) return;
    renderRole();
    renderFolders();
    renderToolbar();
    renderGrid();
    renderSelbar();
    renderLog();
  }

  /* ---------- the dialog: one image ---------- */

  var dlgPath = null;
  function openDialog(p) {
    var f = S.files[p];
    if (!f) return;
    dlgPath = p;
    var m = S.manifest[p] || {};
    $('imDlgTitle').textContent = f.name;
    $('imDlgImg').src = thumb(p);
    $('imDlgImg').alt = f.name;
    $('imDlgUrl').value = worldUrl(p);
    $('imDlgName').value = f.name.replace(/\.png$/, '');
    $('imDlgDownload').href = thumb(p);
    var dl = $('imDlgFacts');
    dl.textContent = '';
    function fact(k, v) { if (!v) return; dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); }
    fact('Folder', label(f.folder));
    fact('Size', (m.w ? m.w + ' × ' + m.h + ' px · ' : '') + kb(f.size));
    fact(m.approvedBy ? 'Suggested' : 'Uploaded', m.by ? m.by + (m.at ? ' · ' + SD.fullDate(m.at) : '') : '');
    fact('Approved by', m.approvedBy);
    fact('From', m.placeholder ? 'Placeholder poster' : m.from);
    fact('Note', m.note);
    fact('Unity source', m.source);
    show('imDlgRenameRow', canEdit());
    show('imDlgDelete', canEdit());
    show('imDlgReplace', canAdd());
    $('imDlgReplace').textContent = canEdit() ? 'Replace…' : 'Suggest a replacement…';
    var waiting = suggFor(p).length;
    show('imDlgSugg', waiting > 0);
    $('imDlgSugg').textContent = waiting ? plural(waiting, 'suggestion') + ' waiting for this slot. ' : '';
    if (waiting) {
      var a = el('button', null, 'See ' + (waiting === 1 ? 'it' : 'them') + ' →');
      a.type = 'button';
      a.addEventListener('click', function () { closeDialog(); S.suggFilter = p; pickFolder(SUGG); });
      $('imDlgSugg').appendChild(a);
    }
    SD.status('imDlgStatus', '');
    var d = $('imDialog');
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }

  function closeDialog() { var d = $('imDialog'); if (d.close) d.close(); else d.removeAttribute('open'); dlgPath = null; }

  /* ---------- the progress pop-up ---------- */

  function openProg() {
    if (!job || job.popup) return;
    job.popup = true;
    var d = $('imProg');
    $('imProgNote').value = '';
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    paintProg();
  }

  function closeProg() {
    var d = $('imProg');
    if (d.open) { if (d.close) d.close(); else d.removeAttribute('open'); }
    if (job) job.popup = false;
  }

  function paintProg() {
    if (!job || !job.popup) return;
    var items = job.items;
    var total = items.length;
    var frac = items.reduce(function (s, it) { return s + STAGES[it.state][0]; }, 0) / total;
    var pct = Math.round(frac * 100);
    var active = items.filter(function (it) { return /reading|decoded|resized|uploading/.test(it.state); })[0];
    var done = items.filter(function (it) { return /saved|sent/.test(it.state); }).length;
    var failed = items.filter(function (it) { return it.state === 'failed'; }).length;
    var ph = job.phase;
    $('imProgTitle').textContent = ph === 'converting' ? 'Converting ' + plural(total, 'image')
      : ph === 'ready' ? 'Ready to send ' + plural(items.filter(function (it) { return it.state === 'ready'; }).length, 'suggestion')
      : ph === 'uploading' ? (job.mode === 'suggest' ? 'Sending for approval' : 'Uploading to the site')
      : ph === 'cancelled' ? 'Cancelled'
      : failed ? (done ? 'Finished with problems' : 'That didn\'t work') : job.mode === 'suggest' ? 'Sent for approval' : 'Saved';
    $('imProgPct').textContent = pct + '%';
    $('imProgFill').style.width = pct + '%';
    $('imProgBar').setAttribute('aria-valuenow', String(pct));
    $('imProgBar').classList.toggle('is-busy', ph === 'converting' || ph === 'uploading');
    $('imProgBar').classList.toggle('is-bad', ph === 'done' && failed > 0);
    var n = active ? items.indexOf(active) + 1 : 0;
    $('imProgLine').textContent = active ? STAGES[active.state][1] + ' ' + active.file.name + (total > 1 ? ' (' + n + ' of ' + total + ')' : '') + '…'
      : ph === 'ready' ? 'Converted. Add a note if it helps, then send them to the developers.'
      : ph === 'done' ? (job.mode === 'suggest'
        ? (done ? plural(done, 'suggestion') + ' sent. A developer will approve or reject ' + (done === 1 ? 'it' : 'them') + '; you\'ll see it in the console.' : '')
        : (done ? plural(done, 'image') + ' saved. The world picks ' + (done === 1 ? 'it' : 'them') + ' up after GitHub Pages updates (1–10 minutes).' : ''))
        + (failed ? ' ' + plural(failed, 'file') + ' failed: see below.' : '')
      : ph === 'cancelled' ? 'Nothing was sent.' : '';
    var ol = $('imProgList');
    ol.textContent = '';
    items.forEach(function (it) {
      var li = el('li', 'is-' + it.state);
      var bar = el('i');
      bar.style.width = Math.round(STAGES[it.state][0] * 100) + '%';
      li.appendChild(bar);
      var name = el('span', 'im-prog-name', it.file.name);
      name.title = it.file.name + ' → ' + it.path;
      li.appendChild(name);
      li.appendChild(el('span', 'im-prog-state', it.error || (STAGES[it.state][1] + (it.w ? ' · ' + it.w + '×' + it.h : ''))));
      ol.appendChild(li);
    });
    show('imProgSlow', (ph === 'converting' || ph === 'uploading') && Date.now() - job.started > SLOW_AFTER_MS);
    show('imProgNoteBox', job.mode === 'suggest' && ph === 'ready');
    show('imProgSend', job.mode === 'suggest' && ph === 'ready');
    $('imProgSend').textContent = 'Send ' + plural(items.filter(function (it) { return it.state === 'ready'; }).length, 'suggestion');
    show('imProgCancel', ph === 'converting' || ph === 'ready');
    show('imProgDone', ph === 'done' || ph === 'cancelled');
  }

  var slowTick = 0;
  function setPhase(ph) {
    if (!job) return;
    job.phase = ph;
    clearInterval(slowTick);
    if (ph === 'converting' || ph === 'uploading') slowTick = setInterval(paintProg, 500);
    if (ph === 'ready') openProg();   // admins add a note and press Send here
    paintProg();
  }

  function finishJob() {
    var j = job;
    setPhase('done');
    var failed = j.items.some(function (it) { return it.state === 'failed'; });
    if (failed) openProg();   // problems always get shown; a quick clean save never flashes a pop-up
    if (!failed) setTimeout(function () { if (job === j && j.phase === 'done') { closeProg(); job = null; } }, j.mode === 'suggest' ? 2600 : 1300);
  }

  function setState(it, state) { it.state = state; paintProg(); }

  /* ---------- adding files ---------- */

  function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, 'Files') >= 0; }

  var replaceTarget = null;
  function pickFile(target) {
    if (!canAdd()) return;
    replaceTarget = target || null;
    var inp = $('imFile');
    inp.multiple = !target;
    inp.value = '';
    inp.click();
  }

  // New names: numbered folders keep counting (posters 65, 66, …); others use the file's own name. Paths that
  // are waiting as suggestions count as taken, so two suggestions never fight over one new slot.
  function newName(folder, original, taken) {
    var used = {};
    inFolder(folder).forEach(function (p) { used[p] = true; });
    S.suggestions.forEach(function (s) { if (folderOf(s.path) === folder) used[s.path] = true; });
    Object.keys(taken).forEach(function (p) { if (folderOf(p) === folder) used[p] = true; });
    var names = Object.keys(used).map(nameOf);
    var numbered = names.length > 0 && names.every(function (n) { return /^\d+\.png$/.test(n); });
    if (numbered || !names.length && /^\d+$/.test(slug(original))) {
      var max = names.reduce(function (m, n) { return Math.max(m, parseInt(n, 10) || 0); }, 0);
      return folder + '/' + (max + 1) + '.png';
    }
    var base = slug(original) || 'image';
    var p = folder + '/' + base + '.png', i = 2;
    while (used[p]) p = folder + '/' + base + '-' + (i++) + '.png';
    return p;
  }

  function addFiles(list, opts) {
    opts = opts || {};
    var files = Array.prototype.filter.call(list || [], function (f) { return f && f.size > 0; });
    if (!files.length || !S.loaded || !canAdd()) return;
    if (job && job.phase !== 'done' && job.phase !== 'cancelled') { log('bad', 'Still working on the last batch. Drop these again when it finishes.'); openProg(); return; }
    if (job) { closeProg(); job = null; }
    if (window.ScuffedCrop && window.ScuffedCrop.isOpen()) return;
    var folder = opts.folder || (S.folder === SUGG ? folders()[0] : S.folder);
    if (opts.replace) files = files.slice(0, 1);
    var mode = canEdit() ? 'save' : 'suggest';
    // names first, so the cropper can say where each picture goes
    var taken = {};
    S.pending.forEach(function (it) { if (it.state !== 'failed' && it.state !== 'cancelled') taken[it.path] = true; });
    var paths = files.map(function (file) { var p = opts.replace || newName(folder, file.name, taken); taken[p] = true; return p; });
    var cur = opts.replace ? S.manifest[opts.replace] || {} : null;
    window.ScuffedCrop.open({
      files: files,
      prefs: prefsFor(folder),
      replace: opts.replace ? { path: opts.replace, w: cur.w, h: cur.h } : null,
      targetFor: function (f, i) { return paths[i]; },
      title: mode === 'save' ? (opts.replace ? 'Replace ' + nameOf(opts.replace) : 'Crop & confirm') : (opts.replace ? 'Suggest a replacement for ' + nameOf(opts.replace) : 'Crop & suggest'),
      confirmText: mode === 'save' ? (opts.replace ? 'Replace' : 'Upload') : 'Suggest'
    }).then(function (res) {
      if (!opts.replace) setPrefs(folder, res.prefs);
      if (!res.items.length) { log('info', 'Nothing uploaded: cancelled in the cropper.'); return; }
      var chosen = res.items.map(function (r) {
        var i = files.indexOf(r.file);
        return { id: ++seq, file: r.file, folder: folder, path: paths[i], name: nameOf(paths[i]), replaceSha: opts.replace ? S.files[opts.replace].sha : null, state: 'queued', opts: r.opts, mode: mode };
      });
      startJob(chosen, mode, opts.replace);
    });
  }

  // Convert the confirmed pictures one at a time in the background (progress pop-up open the whole time), check
  // each really is a PNG, then save them (developers) or wait for "Send" (admins).
  function startJob(items, mode, replace) {
    S.pending = S.pending.filter(function (it) { return it.state !== 'failed' && it.state !== 'cancelled'; }).concat(items);
    job = { items: items, mode: mode, started: Date.now(), popup: false, cancelled: false, phase: 'converting' };
    var j = job;
    setPhase('converting');
    setTimeout(function () { if (job === j && j.phase === 'converting') openProg(); }, POPUP_AFTER_MS);
    var verb = mode === 'save' ? (replace ? 'Replacing ' + replace + ' with ' + items[0].file.name : 'Adding ' + plural(items.length, 'image') + ' to ' + label(items[0].folder))
      : (replace ? 'Suggesting ' + items[0].file.name + ' for ' + replace : 'Suggesting ' + plural(items.length, 'image') + ' for ' + label(items[0].folder));
    log('work', verb + ' (' + items[0].opts.label + ')…');
    renderGrid();

    items.reduce(function (chain, it) {
      return chain.then(function () {
        if (j.cancelled) { setState(it, 'cancelled'); return; }
        setState(it, 'reading'); renderGrid();
        return convert(it.file, it.opts, function (stage) { if (it.state !== 'cancelled') setState(it, stage); }).then(function (r) {
          return isPng(r.blob).then(function (ok) {
            if (!ok) throw new Error('The browser didn\'t produce a PNG, so it wasn\'t sent. Try another browser.');
            return r;
          });
        }).then(function (r) {
          it.blob = r.blob.type === 'image/png' ? r.blob : new Blob([r.blob], { type: 'image/png' });
          it.w = r.w; it.h = r.h;
          it.url = URL.createObjectURL(it.blob);
          if (j.cancelled) { setState(it, 'cancelled'); return; }
          setState(it, mode === 'save' ? 'converted' : 'ready');
          log('info', it.file.name + ' (' + r.srcW + '×' + r.srcH + ', ' + kb(it.file.size) + ') → ' + it.name + ' ' + r.w + '×' + r.h + ' PNG, ' + kb(it.blob.size));
        }, function (e) {
          fail(it, e.message);
        }).then(renderGrid);
      });
    }, Promise.resolve()).then(function () {
      if (j.cancelled) return;
      var ready = items.filter(function (it) { return it.state === 'converted' || it.state === 'ready'; });
      if (!ready.length) { finishJob(); return; }
      if (mode === 'save') { setPhase('uploading'); queueSave(ready); }
      else setPhase('ready');
    });
  }

  function cancelJob() {
    if (!job) return;
    if (job.phase === 'converting' || job.phase === 'ready') {
      job.cancelled = true;
      job.items.forEach(function (it) { if (!/saved|sent|failed/.test(it.state)) it.state = 'cancelled'; });
      S.pending = S.pending.filter(function (it) { return job.items.indexOf(it) < 0; });
      log('info', 'Cancelled. Nothing was sent.');
      setPhase('cancelled');
      closeProg();
      job = null;
      renderGrid();
    }
  }

  function fail(it, msg) {
    it.state = 'failed';
    it.error = msg;
    log('bad', it.file.name + ': ' + msg);
    paintProg();
  }

  function queueSave(items) {
    var j = job;
    saveChain = saveChain.then(function () { return saveItems(items, false); }).then(function () { if (job === j) finishJob(); });
  }

  function batches(items) {
    var out = [], cur = [], bytes = 0;
    items.forEach(function (it) {
      var b = it.blob.size * 1.37;
      if (cur.length && (cur.length >= BATCH_COUNT || bytes + b > BATCH_BYTES)) { out.push(cur); cur = []; bytes = 0; }
      cur.push(it); bytes += b;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  function saveItems(items, retried) {
    return batches(items).reduce(function (chain, batch) {
      return chain.then(function () {
        batch.forEach(function (it) { setState(it, 'uploading'); });
        renderGrid();
        return Promise.all(batch.map(function (it) { return toBase64(it.blob); })).then(function (datas) {
          var ops = batch.map(function (it, i) { return { op: 'put', path: it.path, sha: it.replaceSha, data: datas[i], from: it.file.name }; });
          return worker('/images', { ops: ops });
        }).then(function (res) {
          (res.changes || []).forEach(function (c) { applyChange(c, batch); });
          batch.forEach(function (it) {
            S.manifest[it.path] = { w: it.w, h: it.h, from: it.file.name, by: myName() || 'you', at: new Date().toISOString() };
            setState(it, 'saved');
          });
          S.pending = S.pending.filter(function (it) { return batch.indexOf(it) < 0; });
          log('good', 'Saved ' + batch.map(function (it) { return it.path; }).join(', ') + '.');
          render();
          refreshLog();
        }, function (e) {
          if (e.status === 409 && !retried) {
            log('bad', SD.errText(e));
            return load(true).then(function () {
              var again = [];
              batch.forEach(function (it) {
                if (it.replaceSha) { fail(it, 'Someone changed this image first. Check it, then replace it again.'); return; }
                var taken = {};
                S.pending.forEach(function (q) { if (q !== it) taken[q.path] = true; });
                it.path = newName(it.folder, it.file.name, taken);
                it.name = nameOf(it.path);
                again.push(it);
              });
              renderGrid();
              if (again.length) return saveItems(again, true);
            });
          }
          batch.forEach(function (it) { fail(it, SD.errText(e)); });
          renderGrid();
        });
      });
    }, Promise.resolve());
  }

  // Admins: send the converted pictures as suggestions (one commit on the suggestions branch per batch).
  function sendSuggestions() {
    if (!job || job.phase !== 'ready') return;
    var j = job;
    var note = $('imProgNote').value.trim();
    var items = j.items.filter(function (it) { return it.state === 'ready'; });
    setPhase('uploading');
    saveChain = saveChain.then(function () {
      return batches(items).reduce(function (chain, batch) {
        return chain.then(function () {
          batch.forEach(function (it) { setState(it, 'uploading'); });
          renderGrid();
          return Promise.all(batch.map(function (it) { return toBase64(it.blob); })).then(function (datas) {
            return worker('/images/suggest', { note: note, items: batch.map(function (it, i) { return { path: it.path, sha: it.replaceSha, data: datas[i], from: it.file.name }; }) });
          }).then(function (res) {
            (res.suggestions || []).forEach(function (s) { S.suggestions.push(s); });
            batch.forEach(function (it) { setState(it, 'sent'); });
            S.pending = S.pending.filter(function (it) { return batch.indexOf(it) < 0; });
            log('good', 'Sent for approval: ' + batch.map(function (it) { return it.path; }).join(', ') + '.');
          }, function (e) {
            batch.forEach(function (it) { fail(it, SD.errText(e)); });
            if (e.status === 409) load(true);
          });
        });
      }, Promise.resolve()).then(function () {
        if (job === j) finishJob();
        load(true);   // picks up the branch head so the new suggestions' pictures show
      });
    });
  }

  function applyChange(c, batch) {
    if (!c.sha) { delete S.files[c.path]; delete S.thumbs[c.path]; delete S.manifest[c.path]; return; }
    var it = batch && batch.filter(function (b) { return b.path === c.path; })[0];
    var old = S.files[c.path];
    S.files[c.path] = { path: c.path, folder: folderOf(c.path), name: nameOf(c.path), sha: c.sha, size: it ? it.blob.size : (old ? old.size : 0) };
    if (it) S.thumbs[c.path] = { sha: c.sha, url: it.url };
  }

  function refreshLog() {
    // GitHub can take a moment to list a brand-new commit for a path
    setTimeout(function () {
      worker('/images/log').then(function (r) { S.commits = (r.commits || []).map(parseCommit); renderLog(); }, function () {});
    }, 1500);
  }

  /* ---------- reviewing suggestions ---------- */

  function review(s, action, btn, force) {
    var reason = '';
    if (action === 'reject') {
      reason = window.prompt('Reject the suggestion for ' + s.path + ' from ' + s.by + '?\n\nReason (optional, shown in the console):', '');
      if (reason === null) return;
    }
    if (action === 'withdraw' && !window.confirm('Withdraw your suggestion for ' + s.path + '?')) return;
    if (btn) btn.disabled = true;
    var words = { approve: 'Approving', reject: 'Rejecting', withdraw: 'Withdrawing' };
    log('work', words[action] + ' ' + s.by + '’s suggestion for ' + s.path + '…');
    saveChain = saveChain.then(function () {
      return worker('/images/review', { id: s.id, action: action, reason: reason, force: !!force }).then(function (res) {
        S.suggestions = S.suggestions.filter(function (x) { return x.id !== s.id; });
        if (action === 'approve' && res.sha) {
          var old = S.files[s.path];
          S.files[s.path] = { path: s.path, folder: folderOf(s.path), name: nameOf(s.path), sha: res.sha, size: old ? old.size : 0 };
          S.thumbs[s.path] = { sha: res.sha, url: suggThumb(s) };
          S.manifest[s.path] = { w: s.w, h: s.h, from: s.from, by: s.by, approvedBy: myName(), at: new Date().toISOString(), note: s.note };
        }
        log('good', { approve: 'Approved: ' + s.path + ' is on the site now.', reject: 'Rejected the suggestion for ' + s.path + '.', withdraw: 'Withdrew your suggestion for ' + s.path + '.' }[action]);
        render();
        refreshLog();
        setTimeout(function () { load(true); }, 2500);
      }, function (e) {
        if (btn) btn.disabled = false;
        if (e.code === 'slot-changed' && !force) {
          log('bad', SD.errText(e));
          if (window.confirm(SD.errText(e) + '\n\nApprove anyway?')) return review(s, action, btn, true);
          return;
        }
        log('bad', words[action] + ' failed: ' + SD.errText(e));
        if (e.status === 404 || e.status === 409) load(true);
      });
    });
  }

  /* ---------- delete, rename (developers) ---------- */

  function save(ops, what) {
    saveChain = saveChain.then(function () {
      log('work', what + '…');
      return worker('/images', { ops: ops }).then(function (res) {
        var moved = {};
        ops.forEach(function (o) { if (o.op === 'move') moved[o.to] = o.path; });
        (res.changes || []).forEach(function (c) {
          if (c.sha && moved[c.path]) {
            var from = moved[c.path];
            S.thumbs[c.path] = S.thumbs[from];
            S.manifest[c.path] = S.manifest[from];
            var old = S.files[from];
            S.files[c.path] = { path: c.path, folder: folderOf(c.path), name: nameOf(c.path), sha: c.sha, size: old ? old.size : 0 };
          }
        });
        (res.changes || []).forEach(function (c) { if (!c.sha) applyChange(c); });
        ops.forEach(function (o) { delete S.selected[o.path]; });
        log('good', what + ': done.');
        render();
        refreshLog();
        return true;
      }, function (e) {
        log('bad', what + ' failed: ' + SD.errText(e));
        if (e.status === 409) load(true);
        return false;
      });
    });
    return saveChain;
  }

  function removePaths(paths) {
    if (!canEdit()) return;
    paths = paths.filter(function (p) { return S.files[p]; });
    if (!paths.length) return;
    var msg = paths.length === 1 ? 'Delete ' + paths[0] + '?' : 'Delete ' + paths.length + ' images?';
    if (!window.confirm(msg + '\n\nThe world stops finding ' + (paths.length === 1 ? 'it' : 'them') + ' at the old address. Old versions stay in the site\'s history on GitHub.')) return;
    save(paths.map(function (p) { return { op: 'delete', path: p, sha: S.files[p].sha }; }), 'Deleting ' + (paths.length === 1 ? paths[0] : paths.length + ' images'));
  }

  function rename() {
    var p = dlgPath;
    if (!p || !S.files[p] || !canEdit()) return;
    var name = slug($('imDlgName').value);
    if (!NAME_RE.test(name)) return SD.status('imDlgStatus', 'Use lowercase letters, numbers, - and _.', 'bad');
    var to = folderOf(p) + '/' + name + '.png';
    if (to === p) return SD.status('imDlgStatus', 'That\'s already its name.');
    if (S.files[to]) return SD.status('imDlgStatus', to + ' already exists.', 'bad');
    SD.status('imDlgStatus', 'Renaming…');
    save([{ op: 'move', path: p, to: to, sha: S.files[p].sha }], 'Renaming ' + p + ' → ' + to).then(function (ok) {
      if (ok) { closeDialog(); } else SD.status('imDlgStatus', 'Couldn\'t rename it. See the console.', 'bad');
    });
  }

  function copy(text) {
    var done = function () { log('info', 'Copied ' + text); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { window.prompt('Copy this URL:', text); });
    else window.prompt('Copy this URL:', text);
  }

  /* ---------- drag and drop, paste ---------- */

  var dragDepth = 0;
  function dropTargetCard(e) {
    var c = e.target && e.target.closest ? e.target.closest('.im-card[data-path]') : null;
    return c && S.files[c.getAttribute('data-path')] ? c : null;
  }
  function endDrag() {
    dragDepth = 0;
    show('imDrop', false);
    document.querySelectorAll('.im-card.is-target').forEach(function (c) { c.classList.remove('is-target'); });
  }
  function dropReady(e) { return hasFiles(e) && S.loaded && SD.me() && canAdd(); }

  function wireDrops() {
    document.addEventListener('dragenter', function (e) {
      if (!dropReady(e)) return;
      dragDepth++;
      show('imDrop', true);
    });
    document.addEventListener('dragleave', function () { if (--dragDepth <= 0) endDrag(); });
    document.addEventListener('dragover', function (e) {
      if (!dropReady(e)) return;
      e.preventDefault();
      var c = dropTargetCard(e);
      document.querySelectorAll('.im-card.is-target').forEach(function (x) { if (x !== c) x.classList.remove('is-target'); });
      if (c) c.classList.add('is-target');
      var target = S.folder === SUGG ? folders()[0] : S.folder;
      $('imDropTitle').textContent = c
        ? (canEdit() ? 'Drop to replace ' : 'Drop to suggest a replacement for ') + c.getAttribute('data-path')
        : (canEdit() ? 'Drop to add to ' : 'Drop to suggest for ') + label(target);
      $('imDropSub').textContent = 'You crop and confirm first · saved as PNG, 512px or smaller' + (canEdit() ? '' : ' · a developer approves it');
    });
    document.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      var c = dropTargetCard(e);
      endDrag();
      if (!dropReady(e)) return;
      if (c) addFiles(e.dataTransfer.files, { replace: c.getAttribute('data-path'), folder: folderOf(c.getAttribute('data-path')) });
      else addFiles(e.dataTransfer.files, {});
    });
    document.addEventListener('paste', function (e) {
      if (!S.loaded || !SD.me() || !canAdd()) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      var files = Array.prototype.filter.call((e.clipboardData && e.clipboardData.files) || [], function (f) { return /^image\//.test(f.type); });
      if (!files.length) return;
      e.preventDefault();
      addFiles(files.map(function (f, i) { return f.name && f.name !== 'image.png' ? f : new File([f], 'pasted-' + Date.now() + (i ? '-' + i : '') + '.png', { type: f.type }); }), {});
    });
  }

  /* ---------- wiring ---------- */

  function wire() {
    SD.on('imUpload', 'click', function () { pickFile(null); });
    SD.on('imFile', 'change', function () {
      var files = $('imFile').files;
      if (replaceTarget) addFiles(files, { replace: replaceTarget, folder: folderOf(replaceTarget) });
      else addFiles(files, {});
      replaceTarget = null;
    });
    SD.on('imSearch', 'input', function () { S.search = $('imSearch').value; renderGrid(); });
    document.querySelectorAll('#imLogFilter [data-log]').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-log') === S.logFilter));
      b.addEventListener('click', function () {
        S.logFilter = b.getAttribute('data-log');
        document.querySelectorAll('#imLogFilter [data-log]').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
        renderLog();
      });
    });
    SD.on('imSelClear', 'click', function () { S.selected = {}; renderGrid(); renderSelbar(); });
    SD.on('imSelDelete', 'click', function () { removePaths(Object.keys(S.selected)); });
    SD.on('imDlgCopy', 'click', function () { copy($('imDlgUrl').value); SD.status('imDlgStatus', 'Copied.', 'good'); });
    SD.on('imDlgRename', 'click', rename);
    SD.on('imDlgName', 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); rename(); } });
    SD.on('imDlgReplace', 'click', function () { var p = dlgPath; closeDialog(); pickFile(p); });
    SD.on('imDlgDelete', 'click', function () { var p = dlgPath; closeDialog(); removePaths([p]); });
    $('imDialog').addEventListener('click', function (e) { if (e.target === $('imDialog')) closeDialog(); });
    SD.on('imProgCancel', 'click', cancelJob);
    SD.on('imProgSend', 'click', sendSuggestions);
    SD.on('imProgDone', 'click', function () { closeProg(); job = null; });
    // Esc: cancels while converting or waiting to send; can't close the pop-up mid-upload
    $('imProg').addEventListener('cancel', function (e) {
      e.preventDefault();
      if (!job) return closeProg();
      if (job.phase === 'converting' || job.phase === 'ready') cancelJob();
      else if (job.phase === 'done' || job.phase === 'cancelled') { closeProg(); job = null; }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement === document.body && SD.me()) { e.preventDefault(); $('imSearch').focus(); }
    });
    window.addEventListener('hashchange', function () { var f = fromHash(); if (f && f !== S.folder && (f === SUGG || folders().indexOf(f) >= 0)) { S.folder = f; render(); } });
    wireDrops();
  }

  function boot() {
    wire();
    renderLog();
    SD.start({
      onIn: function (me, first) {
        if (first) {
          log('info', 'Signed in as ' + me.name + ' (' + (SD.LEVEL_NAMES[me.level] || 'staff') + ').');
          clearInterval(timer);
          timer = setInterval(function () { if (!document.hidden && SD.me() && !job) load(true); }, POLL_MS);
        }
        load(!first);
      },
      onOut: function () { clearInterval(timer); S.loaded = false; }
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && SD.me() && S.loaded && !job) load(true); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
