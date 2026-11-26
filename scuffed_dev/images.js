// scuffed_dev/images.js: the world images page (kanaris-beans.com/scuffed_dev/images/). Moderators and up.
//
// Everything the Scuffed world downloads as a picture lives in /scuffed/images/<folder>/<name>.png on the site.
// This page lists those folders, and lets staff add, replace, rename and delete images on the fly:
//
//   drop / pick / paste any image  ->  converted in a background worker (any format the browser can read, to
//   PNG, longest side 512px, or an A4 poster 362x512)  ->  sent to the scuffed-perms Worker, which checks the
//   caller's staff level and the PNG again, then commits it to the site repo (one commit per batch).
//
// The console on the right is the audit log: every commit that touched the folder (who, when, what), plus what
// this tab is doing right now. Signing in and the staff gate come from /scuffed_dev/core.js; the Worker is the lock.
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
  var NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

  // Folders the world already uses, in this order; any other folder shows after them.
  var KNOWN = {
    posters: { label: 'Posters', shape: 'a4fill', note: 'A4 poster slots, numbered 1–64. New images are cropped to A4 unless you pick another shape.' },
    players: { label: 'Players', note: 'Player and premium member photos from the world.' },
    scuffed: { label: 'Scuffed', note: 'Scuffed’s own pictures: Balatro wall, premium sign, logos.' },
    events: { label: 'Events', note: 'Event and partner group logos (4 days of fall).' },
    ads: { label: 'Ads', note: 'Advertisement boards and wall art.' },
    balatro: { label: 'Balatro', note: 'Balatro sprite sheets used by the card game.' }
  };
  var ORDER = Object.keys(KNOWN);
  var SHAPES = { keep: 'Keep shape', a4fill: 'A4 fill', a4fit: 'A4 fit' };

  var S = {
    loaded: false,
    head: null,
    files: {},          // path -> { path, folder, name, sha, size }
    manifest: {},       // path -> { w, h, from, by, at, placeholder, source }
    thumbs: {},         // path -> { sha, url }  (keeps a picture's URL while its sha doesn't change)
    localFolders: [],   // made on this page, empty until the first upload
    folder: null,
    search: '',
    selected: {},
    pending: [],        // uploads in flight: { id, path, folder, name, replaceSha, file, state, url, error }
    commits: [],
    local: [],          // this tab's console lines: { at, kind, text }
    logFilter: 'all'
  };
  var saveChain = Promise.resolve();
  var timer = 0;
  var seq = 0;

  /* ---------- small helpers ---------- */

  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function folderOf(p) { return p.split('/')[0]; }
  function nameOf(p) { return p.split('/').slice(1).join('/'); }
  function label(f) { return (KNOWN[f] && KNOWN[f].label) || f.charAt(0).toUpperCase() + f.slice(1).replace(/[-_]/g, ' '); }
  function natural(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }
  function slug(s) {
    return String(s || '').replace(/\.[a-z0-9]{2,5}$/i, '').toLowerCase().replace(/&/g, ' and ')
      .replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 60);
  }
  function folders() {
    var set = {};
    Object.keys(S.files).forEach(function (p) { set[folderOf(p)] = true; });
    S.localFolders.forEach(function (f) { set[f] = true; });
    var extra = Object.keys(set).filter(function (f) { return !KNOWN[f]; }).sort(natural);
    return ORDER.filter(function (f) { return set[f]; }).concat(extra);
  }
  function inFolder(f) { return Object.keys(S.files).filter(function (p) { return folderOf(p) === f; }).sort(function (a, b) { return natural(nameOf(a), nameOf(b)); }); }
  function thumb(p) { var t = S.thumbs[p]; return t ? t.url : ''; }
  function worldUrl(p) { return SITE + p; }
  function shapeFor(f) {
    try { var v = localStorage.getItem('scd-images-shape:' + f); if (SHAPES[v]) return v; } catch (e) { /* private mode */ }
    return (KNOWN[f] && KNOWN[f].shape) || 'keep';
  }
  function setShape(f, v) { try { localStorage.setItem('scd-images-shape:' + f, v); } catch (e) { /* fine */ } }

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
    lines.slice(1).forEach(function (l) {
      var m = /^Saved by (.+?)(?: from .*)?$/.exec(l);
      if (m) { by = m[1]; return; }
      var o = /^([+~\->]) (.+)$/.exec(l);
      if (o) ops.push({ sym: o[1], text: o[2] });
    });
    return { sha: c.sha, at: c.date, title: title, by: by || 'someone', ops: ops };
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
        li.classList.add('is-save');
        var h = el('div', 'im-log-head');
        h.appendChild(el('span', 'im-log-tag', '◆'));
        var t = el('span', 'im-log-text');
        t.appendChild(el('strong', null, c.by));
        t.appendChild(document.createTextNode(' ' + c.title));
        h.appendChild(t);
        h.appendChild(when);
        li.appendChild(h);
        if (c.ops.length) {
          var ul = el('ul', 'im-log-ops');
          c.ops.slice(0, 6).forEach(function (o) {
            var oi = el('li', 'op-' + ({ '+': 'add', '~': 'rep', '-': 'del', '>': 'mov' })[o.sym]);
            oi.appendChild(el('b', null, o.sym));
            oi.appendChild(document.createTextNode(' ' + o.text));
            ul.appendChild(oi);
          });
          if (c.ops.length > 6) ul.appendChild(el('li', 'op-more', '… and ' + (c.ops.length - 6) + ' more'));
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
        if (!r.ok) { var e = new Error(data.error || 'The image server answered ' + r.status); e.status = r.status; throw e; }
        return data;
      });
    }, function (e) {
      if (e && e.status) throw e;
      throw new Error('Couldn\'t reach the image server. Check your connection and try again.');
    });
  }

  /* ---------- converting: any image -> PNG, in a background worker ---------- */

  // Where the picture goes on the output canvas. Pure: also runs inside the background worker.
  function plan(sw, sh, shape) {
    var MAX = 512, AW = 362, AH = 512, s;
    if (shape === 'a4fill' || shape === 'a4fit') {
      s = shape === 'a4fill' ? Math.max(AW / sw, AH / sh) : Math.min(AW / sw, AH / sh);
      var cw = shape === 'a4fill' ? AW / s : sw, ch = shape === 'a4fill' ? AH / s : sh;
      var dw = shape === 'a4fill' ? AW : Math.max(1, Math.round(sw * s)), dh = shape === 'a4fill' ? AH : Math.max(1, Math.round(sh * s));
      return { w: AW, h: AH, sx: (sw - cw) / 2, sy: (sh - ch) / 2, sw: cw, sh: ch, dx: Math.round((AW - dw) / 2), dy: Math.round((AH - dh) / 2), dw: dw, dh: dh };
    }
    s = MAX / Math.max(sw, sh);
    var w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
    return { w: w, h: h, sx: 0, sy: 0, sw: sw, sh: sh, dx: 0, dy: 0, dw: w, dh: h };
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
        var p = plan(bmp.width, bmp.height, d.shape);
        var out = draw(function (w, h) { return new OffscreenCanvas(w, h); }, bmp, p);
        var sw = bmp.width, sh = bmp.height;
        bmp.close();
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
      bg.onmessage = function (e) { var w = bgWaiting[e.data.id]; delete bgWaiting[e.data.id]; if (w) w(e.data); };
      bg.onerror = function () { bg = false; };
    } catch (e) { bg = false; }
    return bg;
  }

  // Fallback on the page itself: anything an <img> can show (SVG, or when the worker can't read the file).
  function convertHere(file, shape) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var sw = img.naturalWidth || 512, sh = img.naturalHeight || 512;
        var p = plan(sw, sh, shape);
        var out = draw(function (w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }, img, p);
        out.toBlob(function (blob) {
          URL.revokeObjectURL(url);
          if (!blob) return reject(new Error('the browser couldn\'t make a PNG'));
          resolve({ blob: blob, w: p.w, h: p.h, srcW: sw, srcH: sh });
        }, 'image/png');
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
      img.src = url;
    });
  }

  function convert(file, shape) {
    var w = background();
    var first = w ? new Promise(function (resolve, reject) {
      var id = ++seq;
      bgWaiting[id] = function (d) { if (d.error) reject(new Error(d.error)); else resolve(d); };
      w.postMessage({ id: id, file: file, shape: shape });
    }) : Promise.reject(new Error('no worker'));
    return first.catch(function () { return convertHere(file, shape); }).catch(function () {
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
    var keep = {};
    S.head = data.head;
    S.manifest = data.manifest || {};
    var files = {};
    (data.files || []).forEach(function (f) {
      if (!/\.png$/i.test(f.path) || f.path.indexOf('/') < 0) return;
      files[f.path] = { path: f.path, folder: folderOf(f.path), name: nameOf(f.path), sha: f.sha, size: f.size };
      var t = S.thumbs[f.path];
      if (!t || t.sha !== f.sha) S.thumbs[f.path] = { sha: f.sha, url: RAW + data.head + '/' + DIR + f.path };
      keep[f.path] = true;
    });
    S.files = files;
    Object.keys(S.selected).forEach(function (p) { if (!files[p]) delete S.selected[p]; });
    S.localFolders = S.localFolders.filter(function (f) { return !inFolder(f).length; });
    S.loaded = true;
  }

  function load(quiet) {
    return Promise.all([worker('/images'), worker('/images/log').catch(function () { return null; })]).then(function (r) {
      var before = S.head;
      applyList(r[0]);
      if (r[1]) S.commits = (r[1].commits || []).map(parseCommit);
      if (!S.folder || folders().indexOf(S.folder) < 0) pickFolder(fromHash() || folders()[0] || 'posters', true);
      SD.status('imStatus', '');
      show('imStatus', false);
      if (!quiet) log('info', 'Loaded ' + Object.keys(S.files).length + ' images in ' + folders().length + ' folders.');
      else if (before && before !== S.head) log('info', 'Someone saved changes; the page is up to date.');
      render();
    }).catch(function (e) {
      SD.status('imStatus', 'Couldn\'t load the images: ' + SD.errText(e), 'bad');
      show('imStatus', true);
      if (!quiet) log('bad', 'Couldn\'t load the images: ' + SD.errText(e));
    });
  }

  /* ---------- rendering ---------- */

  function fromHash() { var m = /folder=([a-z0-9_-]+)/.exec(location.hash); return m ? m[1] : null; }

  function pickFolder(f, silent) {
    S.folder = f;
    S.selected = {};
    if (!silent || !fromHash()) history.replaceState(null, '', '#folder=' + f);
    if (!silent) render();
  }

  function renderFolders() {
    var box = $('imFolders');
    box.textContent = '';
    folders().forEach(function (f) {
      var n = inFolder(f).length;
      var b = el('button', 'im-folder' + (f === S.folder ? ' is-on' : ''));
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(f === S.folder));
      b.appendChild(el('span', null, label(f)));
      b.appendChild(el('span', 'im-folder-n', String(n)));
      b.addEventListener('click', function () { pickFolder(f); });
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
      box.appendChild(b);
    });
    var add = el('button', 'im-folder im-folder-new', '+ New folder');
    add.type = 'button';
    add.addEventListener('click', function () {
      var name = slug(window.prompt('Name the new folder (lowercase letters, numbers, - and _):', '') || '');
      if (!name) return;
      if (folders().indexOf(name) < 0) S.localFolders.push(name);
      log('info', 'New folder "' + name + '". It is saved with its first image.');
      pickFolder(name);
    });
    box.appendChild(add);
  }

  function renderShape() {
    var cur = shapeFor(S.folder);
    document.querySelectorAll('#imShape [data-shape]').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-shape') === cur));
    });
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

    var pick = el('label', 'im-pick');
    pick.title = 'Select';
    var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!S.selected[p];
    cb.setAttribute('aria-label', 'Select ' + f.name);
    cb.addEventListener('change', function () { if (cb.checked) S.selected[p] = true; else delete S.selected[p]; c.classList.toggle('is-picked', cb.checked); renderSelbar(); });
    pick.appendChild(cb);
    c.appendChild(pick);

    if (meta.placeholder) c.appendChild(el('span', 'im-badge', 'Placeholder'));

    var info = el('div', 'im-card-meta');
    info.appendChild(el('strong', null, f.name));
    info.appendChild(el('span', null, (meta.w ? meta.w + '×' + meta.h + ' · ' : '') + kb(f.size)));
    c.appendChild(info);

    var acts = el('div', 'im-card-actions');
    acts.appendChild(iconBtn('Replace', 'M4 4v6h6M20 20v-6h-6M5.6 15A7 7 0 0 0 18.9 15.4M18.4 9A7 7 0 0 0 5.1 8.6', function () { pickFile(p); }));
    acts.appendChild(iconBtn('Copy world URL', 'M9 9h10v10H9zM5 15V5h10', function () { copy(worldUrl(p)); }));
    acts.appendChild(iconBtn('Delete', 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', function () { removePaths([p]); }, 'im-danger-text'));
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
    veil.appendChild(el('span', null, item.state === 'converting' ? 'Converting…' : item.state === 'uploading' ? 'Uploading…' : item.state === 'queued' ? 'Waiting…' : 'Failed'));
    th.appendChild(veil);
    c.appendChild(th);
    var info = el('div', 'im-card-meta');
    info.appendChild(el('strong', null, item.name));
    info.appendChild(el('span', null, item.error || (item.w ? item.w + '×' + item.h + ' · from ' + item.file.name : 'from ' + item.file.name)));
    c.appendChild(info);
    if (item.state === 'failed') {
      var x = iconBtn('Dismiss', 'M18 6L6 18M6 6l12 12', function () { S.pending = S.pending.filter(function (q) { return q !== item; }); renderGrid(); });
      x.classList.add('im-dismiss');
      c.appendChild(x);
    }
    return c;
  }

  function renderGrid() {
    var grid = $('imGrid');
    grid.textContent = '';
    var q = S.search.trim().toLowerCase();
    var list = inFolder(S.folder).filter(function (p) {
      if (!q) return true;
      var m = S.manifest[p] || {};
      return (nameOf(p) + ' ' + (m.from || '') + ' ' + (m.source || '')).toLowerCase().indexOf(q) >= 0;
    });
    var pend = S.pending.filter(function (it) { return it.folder === S.folder; });
    var replacing = {};
    pend.forEach(function (it) { if (it.replaceSha) replacing[it.path] = it; });
    list.forEach(function (p) { grid.appendChild(replacing[p] ? pendingCard(replacing[p]) : card(p)); });
    pend.forEach(function (it) { if (!it.replaceSha || !S.files[it.path]) grid.appendChild(pendingCard(it)); });
    var empty = !grid.childNodes.length;
    show('imEmpty', empty);
    $('imEmpty').querySelector('strong').textContent = q ? 'No images match “' + S.search.trim() + '”' : 'This folder is empty';
    var note = KNOWN[S.folder] && KNOWN[S.folder].note;
    $('imHint').textContent = (note ? note + ' · ' : '') + 'Drop images anywhere to add them here · drop onto a picture to replace it · or paste with Ctrl+V';
  }

  function renderSelbar() {
    var n = Object.keys(S.selected).length;
    show('imSelbar', n > 0);
    $('imSelCount').textContent = n + ' selected';
  }

  function render() {
    if (!S.loaded) return;
    renderFolders();
    renderShape();
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
    fact('Uploaded', m.by ? m.by + (m.at ? ' · ' + SD.fullDate(m.at) : '') : '');
    fact('From', m.placeholder ? 'Placeholder poster' : m.from);
    fact('Unity source', m.source);
    SD.status('imDlgStatus', '');
    var d = $('imDialog');
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }

  function closeDialog() { var d = $('imDialog'); if (d.close) d.close(); else d.removeAttribute('open'); dlgPath = null; }

  /* ---------- adding files ---------- */

  function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, 'Files') >= 0; }

  var replaceTarget = null;
  function pickFile(target) {
    replaceTarget = target || null;
    var inp = $('imFile');
    inp.multiple = !target;
    inp.value = '';
    inp.click();
  }

  // New names: numbered folders keep counting (posters 65, 66, …); others use the file's own name.
  function newName(folder, original, taken) {
    var names = inFolder(folder).map(nameOf).concat(Object.keys(taken).filter(function (p) { return folderOf(p) === folder; }).map(nameOf));
    var numbered = names.length > 0 && names.every(function (n) { return /^\d+\.png$/.test(n); });
    if (numbered || !names.length && /^\d+$/.test(slug(original))) {
      var max = names.reduce(function (m, n) { return Math.max(m, parseInt(n, 10) || 0); }, 0);
      return folder + '/' + (max + 1) + '.png';
    }
    var base = slug(original) || 'image';
    var p = folder + '/' + base + '.png', i = 2;
    while (S.files[p] || taken[p]) p = folder + '/' + base + '-' + (i++) + '.png';
    return p;
  }

  function addFiles(list, opts) {
    opts = opts || {};
    var files = Array.prototype.filter.call(list || [], function (f) { return f && f.size > 0; });
    if (!files.length || !S.loaded) return;
    var folder = opts.folder || S.folder;
    if (opts.replace) files = files.slice(0, 1);
    var shape = shapeFor(folder);
    var taken = {};
    S.pending.forEach(function (it) { taken[it.path] = true; });
    var items = files.map(function (file) {
      var path = opts.replace || newName(folder, file.name, taken);
      taken[path] = true;
      return { id: ++seq, file: file, folder: folder, path: path, name: nameOf(path), replaceSha: opts.replace ? S.files[opts.replace].sha : null, state: 'queued', shape: shape };
    });
    S.pending = S.pending.concat(items);
    log('work', (opts.replace ? 'Replacing ' + opts.replace + ' with ' + files[0].name : 'Adding ' + items.length + ' image' + (items.length === 1 ? '' : 's') + ' to ' + label(folder)) + ' (' + SHAPES[shape].toLowerCase() + ')…');
    renderGrid();
    // convert one at a time in the background, then save in batches
    items.reduce(function (chain, it) {
      return chain.then(function () {
        it.state = 'converting'; renderGrid();
        return convert(it.file, it.shape).then(function (r) {
          it.blob = r.blob; it.w = r.w; it.h = r.h;
          it.url = URL.createObjectURL(r.blob);
          it.state = 'uploading';
          log('info', it.file.name + ' (' + r.srcW + '×' + r.srcH + ', ' + kb(it.file.size) + ') → ' + it.name + ' ' + r.w + '×' + r.h + ' PNG, ' + kb(r.blob.size));
        }, function (e) {
          fail(it, e.message);
        }).then(renderGrid);
      });
    }, Promise.resolve()).then(function () {
      var ready = items.filter(function (it) { return it.state === 'uploading'; });
      if (ready.length) queueSave(ready);
    });
  }

  function fail(it, msg) {
    it.state = 'failed';
    it.error = msg;
    log('bad', it.file.name + ': ' + msg);
  }

  function queueSave(items) {
    saveChain = saveChain.then(function () { return saveItems(items, false); });
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
        return Promise.all(batch.map(function (it) { return toBase64(it.blob); })).then(function (datas) {
          var ops = batch.map(function (it, i) { return { op: 'put', path: it.path, sha: it.replaceSha, data: datas[i], from: it.file.name }; });
          return worker('/images', { ops: ops });
        }).then(function (res) {
          (res.changes || []).forEach(function (c) { applyChange(c, batch); });
          batch.forEach(function (it) {
            S.manifest[it.path] = { w: it.w, h: it.h, from: it.file.name, by: (SD.me() && SD.me().name) || 'you', at: new Date().toISOString() };
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

  /* ---------- delete, rename ---------- */

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
    paths = paths.filter(function (p) { return S.files[p]; });
    if (!paths.length) return;
    var msg = paths.length === 1 ? 'Delete ' + paths[0] + '?' : 'Delete ' + paths.length + ' images?';
    if (!window.confirm(msg + '\n\nThe world stops finding ' + (paths.length === 1 ? 'it' : 'them') + ' at the old address. Old versions stay in the site\'s history on GitHub.')) return;
    save(paths.map(function (p) { return { op: 'delete', path: p, sha: S.files[p].sha }; }), 'Deleting ' + (paths.length === 1 ? paths[0] : paths.length + ' images'));
  }

  function rename() {
    var p = dlgPath;
    if (!p || !S.files[p]) return;
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

  function wireDrops() {
    document.addEventListener('dragenter', function (e) {
      if (!hasFiles(e) || !S.loaded || !SD.me()) return;
      dragDepth++;
      show('imDrop', true);
    });
    document.addEventListener('dragleave', function () { if (--dragDepth <= 0) endDrag(); });
    document.addEventListener('dragover', function (e) {
      if (!hasFiles(e) || !S.loaded || !SD.me()) return;
      e.preventDefault();
      var c = dropTargetCard(e);
      document.querySelectorAll('.im-card.is-target').forEach(function (x) { if (x !== c) x.classList.remove('is-target'); });
      if (c) c.classList.add('is-target');
      $('imDropTitle').textContent = c ? 'Drop to replace ' + c.getAttribute('data-path') : 'Drop to add to ' + label(S.folder);
      $('imDropSub').textContent = SHAPES[shapeFor(S.folder)] + ' · converted to PNG · longest side 512px';
    });
    document.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      var c = dropTargetCard(e);
      endDrag();
      if (!S.loaded || !SD.me()) return;
      if (c) addFiles(e.dataTransfer.files, { replace: c.getAttribute('data-path'), folder: folderOf(c.getAttribute('data-path')) });
      else addFiles(e.dataTransfer.files, { folder: S.folder });
    });
    document.addEventListener('paste', function (e) {
      if (!S.loaded || !SD.me()) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      var files = Array.prototype.filter.call((e.clipboardData && e.clipboardData.files) || [], function (f) { return /^image\//.test(f.type); });
      if (!files.length) return;
      e.preventDefault();
      addFiles(files.map(function (f, i) { return f.name && f.name !== 'image.png' ? f : new File([f], 'pasted-' + Date.now() + (i ? '-' + i : '') + '.png', { type: f.type }); }), { folder: S.folder });
    });
  }

  /* ---------- wiring ---------- */

  function wire() {
    SD.on('imUpload', 'click', function () { pickFile(null); });
    SD.on('imFile', 'change', function () {
      var files = $('imFile').files;
      if (replaceTarget) addFiles(files, { replace: replaceTarget, folder: folderOf(replaceTarget) });
      else addFiles(files, { folder: S.folder });
      replaceTarget = null;
    });
    SD.on('imSearch', 'input', function () { S.search = $('imSearch').value; renderGrid(); });
    document.querySelectorAll('#imShape [data-shape]').forEach(function (b) {
      b.addEventListener('click', function () {
        setShape(S.folder, b.getAttribute('data-shape'));
        renderShape();
        log('info', label(S.folder) + ': new uploads use ' + SHAPES[b.getAttribute('data-shape')].toLowerCase() + '.');
      });
    });
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
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement === document.body && SD.me()) { e.preventDefault(); $('imSearch').focus(); }
    });
    window.addEventListener('hashchange', function () { var f = fromHash(); if (f && f !== S.folder && folders().indexOf(f) >= 0) { S.folder = f; render(); } });
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
          timer = setInterval(function () { if (!document.hidden && SD.me() && !S.pending.length) load(true); }, POLL_MS);
        }
        load(!first);
      },
      onOut: function () { clearInterval(timer); S.loaded = false; }
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && SD.me() && S.loaded && !S.pending.length) load(true); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
