// scuffed_dev/app/app.js: the scuffed_dev staff app (kanaris-beans.com/scuffed_dev/app/, also the Android APK).
//
// One page, many screens, drawn here:
//   Inbox     notification history (scuffed_push_log), unread dots, filters, turn notifications on
//   Board     the dev board (devboard_* functions): cards, a card's timeline, status / claim / notes, new cards
//   Images    world images (scuffed-perms Worker /images): folders, the picture cache, upload / replace / crop
//             through the website's cropper (images-crop.js), rename, delete, suggestions + review
//   Announce  each world's spawn board + lobby pop-ups (the same file format as /announcements/)
//   More      Deploys (the deploy watcher, deploy.js, headless), Permissions (role lists), Settings
//   Settings  account, notifications per kind, and /chat style appearance (background, accent, glass, text)
//
// Signing in is the site's player account (games-social.js, also how /chat and the website's staff pages sign in);
// levels come from the moderation panel (helper 1, moderator 2, admin 3, developer 4, master 5). The app hides what
// you can't do; the database functions and the Worker check again on every call.
(function () {
  'use strict';

  var VERSION = '1.1.0';
  var WORKER = 'https://scuffed-perms.seanboyle20126.workers.dev';
  var SITE = 'https://kanaris-beans.com';
  var RAW = 'https://raw.githubusercontent.com/Scuffed-VRChat/baloneys.github.io/';
  var RELEASES = 'https://github.com/Scuffed-VRChat/baloneys.github.io/releases';
  var MOD_TOKEN_KEY = 'balcade-mod-token';
  var LOOK_KEY = 'scd-app-look', PREFS_KEY = 'scd-app-prefs', READ_KEY = 'scd-app-read';
  var LEVELS = { 1: 'Helper', 2: 'Moderator', 3: 'Admin', 4: 'Developer', 5: 'Master' };
  var STATUSES = [
    { id: 'unclaimed', label: 'Unclaimed', sym: '○' }, { id: 'claimed', label: 'Claimed', sym: '◔' },
    { id: 'in_progress', label: 'In progress', sym: '◑' }, { id: 'testing', label: 'Testing', sym: '◕' },
    { id: 'complete', label: 'Complete', sym: '●' }
  ];
  var ST = {}; STATUSES.forEach(function (s) { ST[s.id] = s; });
  var KIND_ICON = { announce: '📣', board: '🧩', world: '🌍', deploy: '🚀', suggest: '💡', test: '🔔' };

  /* ======================================================================= helpers */

  function $(id) { return document.getElementById(id); }
  function h(tag, a) {
    var e = document.createElement(tag);
    a = a || {};
    Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(function (x) { add(e, x); }); else e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
  function ic(n) { return '<svg aria-hidden="true"><use href="#i-' + n + '"/></svg>'; }
  function icon(n) { var s = h('span', { html: ic(n) }); return s.firstChild; }
  // Emptying something that was showing a loading skeleton means real content is arriving: mark it so that
  // content fades up (CSS .reveal) instead of popping in.
  function clear(e) {
    if (e.querySelector && e.querySelector('.skel')) { e.classList.add('reveal'); setTimeout(function () { e.classList.remove('reveal'); }, 450); }
    while (e.firstChild) e.removeChild(e.firstChild);
    return e;
  }
  // Tapping a chip re-renders its screen, which builds a brand-new chip bar that would start scrolled back
  // to the left. keepChips(bar, key) puts the bar back where it was last scrolled (per key, for this app
  // session); a bar seen for the first time instead scrolls just far enough to show its selected chip.
  // Call it after the bar is in the page, since scrollLeft does nothing on a detached element.
  var chipScroll = {};
  function keepChips(el, key) {
    if (chipScroll[key] != null) el.scrollLeft = chipScroll[key];
    else {
      var on = el.querySelector('.chip.on');
      if (on) { var x = on.getBoundingClientRect().left - el.getBoundingClientRect().left; if (x + on.offsetWidth > el.clientWidth) el.scrollLeft = x - 16; }
    }
    function remember() { chipScroll[key] = el.scrollLeft; }
    el.addEventListener('scroll', remember, { passive: true });
    el.addEventListener('click', remember, true);  // capture: runs before the chip's own handler re-renders the screen
    return el;
  }
  function errText(e) { return (e && (e.message || e.details || e.error)) || String(e || 'Something went wrong'); }
  function time(v) { return Number.isFinite(v) ? v : Date.parse(v) || 0; }
  function ago(v) {
    var s = Math.max(0, (Date.now() - time(v)) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 86400 * 7) return Math.round(s / 86400) + 'd ago';
    return new Date(time(v)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  function fullDate(v) { return new Date(time(v)).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function load(key, def) { try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? def : v; } catch (e) { return def; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function haptic(ms) { if (prefs.haptics !== false && navigator.vibrate) try { navigator.vibrate(ms || 8); } catch (e) { /* no motor */ } }
  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  function toast(text, kind) {
    var t = h('div', { class: 'toast' + (kind ? ' ' + kind : ''), role: 'status' }, h('i', { text: kind === 'good' ? '✓' : kind === 'bad' ? '!' : '•' }), h('span', { text: text }));
    $('toasts').appendChild(t);
    setTimeout(function () { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; setTimeout(function () { t.remove(); }, 320); }, kind === 'bad' ? 4200 : 2600);
  }

  /* ======================================================================= state */

  var S = { client: null, token: null, me: null, route: 'history', arg: '', loaded: {} };
  var prefs = Object.assign({ haptics: true, compact: false, calm: false, kinds: { announce: true, board: true, world: true, deploy: true, suggest: true } }, load(PREFS_KEY, {}));
  function savePrefs() { save(PREFS_KEY, prefs); }
  function lvl() { return S.me ? S.me.level : 0; }
  function isDev() { return lvl() >= 4; }
  function isAdmin() { return lvl() >= 3; }

  /* ======================================================================= talking to the backend */

  function accessToken() {
    if (!S.client) return Promise.resolve('');
    return S.client.auth.getSession().then(function (r) { return r.data && r.data.session ? r.data.session.access_token : ''; }, function () { return ''; });
  }
  function worker(path, body) {
    return accessToken().then(function (at) {
      var hd = {};
      if (at) hd.Authorization = 'Bearer ' + at;
      if (S.token) hd['X-Mod-Token'] = S.token;
      if (body) hd['Content-Type'] = 'application/json';
      return fetch(WORKER + path, { method: body ? 'POST' : 'GET', headers: hd, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || 'The server answered ' + r.status); e.status = r.status; e.code = d.code; throw e; }
        return d;
      });
    }, function (e) { if (e && e.status) throw e; throw new Error('No connection to the server. Check your signal and try again.'); });
  }
  function rpc(name, args) {
    return S.client.rpc(name, Object.assign({ token: S.token || null }, args || {})).then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function watchDeploy(res, label) { if (res && res.commit && window.ScuffedDeploy) window.ScuffedDeploy.watch({ commit: res.commit, live: res.live, label: label }); }

  /* ======================================================================= appearance (/chat style studio) */

  var THEMES = [
    { id: 'scuffed', name: 'Scuffed', css: null },
    { id: 'ember', name: 'Ember', stops: ['#0a0305', '#4a0812', '#ff1f3d'], angle: 165 },
    { id: 'baloneys', name: 'Baloneys', stops: ['#12001f', '#3b0764', '#e60065'], angle: 150 },
    { id: 'midnight', name: 'Midnight', stops: ['#050510', '#111133', '#1d1d5c'], angle: 180 },
    { id: 'aurora', name: 'Aurora', stops: ['#021b1a', '#0f766e', '#7c3aed'], angle: 135 },
    { id: 'sunset', name: 'Sunset', stops: ['#1a0612', '#9d174d', '#f59e0b'], angle: 160 },
    { id: 'ocean', name: 'Ocean', stops: ['#020617', '#0c4a6e', '#22d3ee'], angle: 200 },
    { id: 'neon', name: 'Neon', stops: ['#0a0014', '#ff00c8', '#00e5ff'], angle: 120 },
    { id: 'candy', name: 'Candy', stops: ['#2a0a2e', '#f472b6', '#a5b4fc'], angle: 135 },
    { id: 'mono', name: 'Mono', stops: ['#050505', '#1f1f1f', '#3f3f46'], angle: 180 }
  ];
  var ACCENTS = [['#ff1f3d', '#ff6b8b'], ['#e60065', '#ff8a00'], ['#9d00ff', '#e60065'], ['#7c3aed', '#db2777'], ['#2563eb', '#06b6d4'],
    ['#06b6d4', '#a78bfa'], ['#10b981', '#06b6d4'], ['#f59e0b', '#ef4444'], ['#ec4899', '#8b5cf6'], ['#a3a3a3', '#f5f5f5']];
  var SCENES = { tetris: ['Surge', 'Pulse', 'Tide', 'Afterglow', 'Strata', 'Storm', 'Warp', 'Stars', 'Circuit City', 'Pixel Aurora'], pong: ['Neon Court', 'Ping Waves', 'LED Rain', 'Arcade Sunset', 'Orbit'], battleships: ['Sonar Sweep', 'Night Swell', 'The Deep'], chess: ['Endless Board', 'Marble', 'Velvet', 'Star Board'] };
  // look.accent: an index into ACCENTS, or a [from, to] pair (copied from /chat). look.bg 'gradient' uses look.grad
  // (from /chat); look.bg 'custom' uses look.custom, the gradient you build in Settings ({ stops: 2-3 hex, angle }).
  var LOOK_DEFAULT = { bg: 'scuffed', solid: '#0b0608', image: null, grad: null, custom: null, scene: 'tetris', sceneIndex: 0, pixel: 2, dim: 35, blur: 0, accent: 0, panel: 82, glass: 18, size: 16 };
  var look = Object.assign({}, LOOK_DEFAULT, load(LOOK_KEY, {}));
  function saveLook() { save(LOOK_KEY, look); }
  function gradCss(t) { return 'linear-gradient(' + t.angle + 'deg, ' + t.stops.join(', ') + ')'; }
  function isHex(c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c); }
  var CUSTOM_DEFAULT = { stops: ['#12001f', '#7331e5', '#eb389d'], angle: 150 };
  function customGrad() {
    var c = look.custom || {}, st = Array.isArray(c.stops) ? c.stops.filter(isHex).slice(0, 3) : [];
    var a = Number(c.angle);
    return st.length >= 2 ? { stops: st, angle: isFinite(a) ? ((Math.round(a) % 360) + 360) % 360 : 150 } : { stops: CUSTOM_DEFAULT.stops.slice(), angle: CUSTOM_DEFAULT.angle };
  }
  function hslHex(hue, s, l) {
    s /= 100; l /= 100;
    var a = s * Math.min(l, 1 - l);
    function f(n) { var k = (n + hue / 30) % 12, v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return ('0' + Math.round(v * 255).toString(16)).slice(-2); }
    return '#' + f(0) + f(8) + f(4);
  }
  function accentPair() {
    if (Array.isArray(look.accent) && isHex(look.accent[0])) return [look.accent[0], isHex(look.accent[1]) ? look.accent[1] : look.accent[0]];
    return ACCENTS[look.accent] || ACCENTS[0];
  }

  function applyLook() {
    var root = document.documentElement.style;
    var acc = accentPair();
    root.setProperty('--acc1', acc[0]);
    root.setProperty('--acc2', acc[1]);
    root.setProperty('--panel-a', String(Math.max(0.2, look.panel / 100)));
    root.setProperty('--glass', look.glass + 'px');
    root.setProperty('--fs', look.size + 'px');
    // text size scales the whole app: nearly everything is sized in rem, which follows the root font size
    root.fontSize = Math.max(12, Math.min(22, look.size || 16)) + 'px';
    $('app').classList.toggle('compact', !!prefs.compact);
    $('app').classList.toggle('calm', !!prefs.calm);
    var bg = $('appBg');
    var sceneSrc = look.bg === 'animated' ? '/chat-scene.html?game=' + encodeURIComponent(look.scene) + '&scene=' + (look.sceneIndex | 0) + '&pixel=' + Math.max(1, Math.min(5, look.pixel | 0 || 2)) : null;
    var running = bg.querySelector('iframe');
    // keep a running scene when only dim / blur / colours change (rebuilding it restarts the animation)
    if (!(running && sceneSrc && running.getAttribute('src') === sceneSrc)) { clear(bg); running = null; }
    bg.className = 'app-bg';
    bg.style.background = '';
    bg.style.setProperty('--img-dim', String(look.dim / 100));
    bg.style.setProperty('--img-blur', look.blur + 'px');
    var th = THEMES.filter(function (t) { return t.id === look.bg; })[0];
    if (th && th.stops) bg.style.background = gradCss(th);
    else if (look.bg === 'gradient' && look.grad && Array.isArray(look.grad.stops)) bg.style.background = gradCss({ angle: Number(look.grad.angle) || 150, stops: look.grad.stops.filter(isHex).slice(0, 3) });
    else if (look.bg === 'custom') bg.style.background = gradCss(customGrad());
    else if (look.bg === 'solid') bg.style.background = look.solid;
    else if (look.bg === 'image' && look.image) { bg.style.background = '#000'; var d = h('div', { class: 'bg-img' }); d.style.setProperty('--img', 'url("' + look.image + '")'); bg.appendChild(d); }
    else if (sceneSrc) {
      bg.style.background = '#070710';
      if (!running) bg.appendChild(h('iframe', { title: 'Animated background', tabindex: '-1', 'aria-hidden': 'true', src: sceneSrc }));
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#0a0608');
  }

  // Copy your /chat look (chat.js saves it as localStorage 'chat.look'; the APK runs in Chrome, so it shares the
  // site's storage). A /chat photo background lives in chat's own IndexedDB ('baloneys-chat', store 'kv',
  // key 'lookImage'); it's only read if that database already exists, so the app never creates an empty one.
  function importChatLook(c) {
    var num = function (v, lo, hi, def) { v = Number(v); return isNaN(v) ? def : Math.max(lo, Math.min(hi, Math.round(v))); };
    if (isHex(c.accent)) look.accent = [c.accent, isHex(c.accent2) ? c.accent2 : c.accent];
    look.panel = num(c.panel, 30, 100, look.panel);
    look.glass = num(c.glassBlur, 0, 30, look.glass);
    look.size = num(c.size, 13, 20, look.size);
    look.dim = num(c.imgDim, 0, 85, look.dim);
    look.blur = num(c.imgBlur, 0, 20, look.blur);
    if (c.grad && Array.isArray(c.grad.stops) && c.grad.stops.filter(isHex).length >= 2) look.grad = { stops: c.grad.stops.filter(isHex).slice(0, 3), angle: num(c.grad.angle, 0, 360, 150) };
    if (c.bg === 'gradient' && look.grad) look.bg = 'gradient';
    else if (c.bg === 'solid' && isHex(c.solid)) { look.bg = 'solid'; look.solid = c.solid; }
    else if (c.bg === 'animated' && SCENES[c.sceneGame]) { look.bg = 'animated'; look.scene = c.sceneGame; look.sceneIndex = num(c.sceneIndex, 0, SCENES[c.sceneGame].length - 1, 0); look.pixel = num(c.scenePixel, 1, 5, 1); }
    else if (c.bg === 'default') look.bg = 'scuffed';
    if (c.bg !== 'image') return Promise.resolve('');
    return readChatImage().then(function (img) {
      if (!img) return 'Copied your /chat look (your /chat photo isn\'t on this phone, so the background stayed)';
      return (/^data:image\//.test(img) ? Promise.resolve(img) : Promise.reject()).then(function (url) { look.image = url; look.bg = 'image'; return ''; });
    }).catch(function () { return 'Copied your /chat look, except the photo background'; });
  }
  function readChatImage() {
    if (!window.indexedDB || !indexedDB.databases) return Promise.resolve(null);
    return indexedDB.databases().then(function (list) {
      if (!list.some(function (d) { return d.name === 'baloneys-chat'; })) return null;
      return new Promise(function (res) {
        var req = indexedDB.open('baloneys-chat');
        req.onupgradeneeded = function () { try { req.transaction.abort(); } catch (e) { /* fine */ } res(null); };
        req.onerror = function () { res(null); };
        req.onsuccess = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains('kv')) { db.close(); res(null); return; }
          var g = db.transaction('kv').objectStore('kv').get('lookImage');
          g.onsuccess = function () { db.close(); var r = g.result; res(r && typeof r === 'object' ? (r.v || r.value || null) : r || null); };
          g.onerror = function () { db.close(); res(null); };
        };
      });
    }, function () { return null; });
  }

  /* ======================================================================= bottom sheet (Android Back closes it) */

  // One history entry stands for "a sheet is open", so Back closes it. Closing it from the app pops that entry with
  // history.back(), which lands later (popstate); anything that changes history meanwhile (a new sheet, a screen
  // change) waits for it, or the late Back would undo it.
  var sheetOpen = false, sheetOnClose = null, backPending = false, afterBackQueue = [];
  function afterBack(fn) { if (backPending) afterBackQueue.push(fn); else fn(); }
  function backLanded() {
    backPending = false;
    var q = afterBackQueue; afterBackQueue = [];
    q.forEach(function (fn) { fn(); });
  }
  function openSheet(title, body, foot, onClose) {
    if (backPending) { afterBack(function () { openSheet(title, body, foot, onClose); }); return; }
    if (sheetOpen) closeSheet(true);   // swapping sheets keeps the one history entry
    $('sheetTitle').textContent = title;
    add(clear($('sheetBody')), body);
    var f = clear($('sheetFoot'));
    add(f, foot);
    f.classList.toggle('hidden', !foot || (Array.isArray(foot) && !foot.length));
    $('scrim').classList.remove('hidden');
    $('sheet').classList.remove('hidden');
    requestAnimationFrame(function () { if (!sheetOpen) return; $('scrim').classList.add('on'); $('sheet').classList.add('on'); });
    sheetOpen = true;
    sheetOnClose = onClose || null;
    if (!(history.state && history.state.sheet)) history.pushState({ sheet: 1 }, '', location.hash);
    haptic(6);
  }
  function closeSheet(viaBack) {
    if (!sheetOpen) return;
    sheetOpen = false;
    $('scrim').classList.remove('on');
    $('sheet').classList.remove('on');
    $('sheet').style.transform = '';
    setTimeout(function () { if (!sheetOpen) { $('scrim').classList.add('hidden'); $('sheet').classList.add('hidden'); } }, 300);
    var cb = sheetOnClose; sheetOnClose = null;
    if (cb) try { cb(); } catch (e) { /* fine */ }
    if (!viaBack && history.state && history.state.sheet) {
      backPending = true;
      history.back();
      setTimeout(function () { if (backPending) backLanded(); }, 600);   // no popstate (odd browsers): carry on anyway
    }
  }
  // drag the grab bar down to close
  (function () {
    var y0 = null, dy = 0;
    function down(e) { y0 = e.touches ? e.touches[0].clientY : e.clientY; dy = 0; $('sheet').style.transition = 'none'; }
    function move(e) { if (y0 === null) return; dy = Math.max(0, (e.touches ? e.touches[0].clientY : e.clientY) - y0); $('sheet').style.transform = 'translateY(' + dy + 'px)'; }
    function up() { if (y0 === null) return; y0 = null; $('sheet').style.transition = ''; if (dy > 110) closeSheet(); else $('sheet').style.transform = ''; }
    document.addEventListener('DOMContentLoaded', function () {
      ['sheetGrab'].forEach(function (id) { var g = $(id); g.addEventListener('touchstart', down, { passive: true }); g.addEventListener('mousedown', down); });
      document.addEventListener('touchmove', move, { passive: true }); document.addEventListener('mousemove', move);
      document.addEventListener('touchend', up); document.addEventListener('mouseup', up);
    });
  })();

  function confirmSheet(title, text, okText, danger) {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (v) { if (done) return; done = true; resolve(v); };
      openSheet(title, h('p', { text: text, style: 'margin:0 0 6px;color:var(--ink2)' }), [
        h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: function () { finish(false); closeSheet(); } }),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', text: okText || 'OK', onclick: function () { finish(true); closeSheet(); } })
      ], function () { finish(false); });
    });
  }
  function promptSheet(title, label, value, okText, check) {
    return new Promise(function (resolve) {
      var done = false, inp = h('input', { class: 'input', value: value || '', autocomplete: 'off', spellcheck: 'false' });
      var msg = h('p', { style: 'margin:0;color:var(--bad);font-size:.82rem;min-height:1.2em' });
      var finish = function (v) { if (done) return; done = true; resolve(v); };
      var ok = function () { var v = inp.value.trim(); var p = check && check(v); if (p) { msg.textContent = p; return; } finish(v); closeSheet(); };
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') ok(); });
      openSheet(title, [h('label', { class: 'field' }, h('span', { text: label }), inp), msg], [
        h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: function () { finish(null); closeSheet(); } }),
        h('button', { class: 'btn primary', type: 'button', text: okText || 'OK', onclick: ok })
      ], function () { finish(null); });
      setTimeout(function () { inp.focus(); inp.select(); }, 320);
    });
  }

  /* ======================================================================= router */

  var SCREENS = { history: renderHistory, board: renderBoard, images: renderImages, announce: renderAnnounce, more: renderMore, deploys: renderDeploys, perms: renderPerms, settings: renderSettings };
  var NAV_OF = { history: 'history', board: 'board', images: 'images', announce: 'announce', more: 'more', deploys: 'more', perms: 'more', settings: 'more' };

  function parseHash() {
    var m = /^#([a-z]+)(?:\/(.*))?$/.exec(location.hash || '');
    return { name: m && SCREENS[m[1]] ? m[1] : 'history', arg: m && m[2] ? decodeURIComponent(m[2]) : '' };
  }
  function go(name, arg) {
    var hash = '#' + name + (arg ? '/' + encodeURIComponent(arg) : '');
    if (sheetOpen) closeSheet();
    afterBack(function () { if (location.hash !== hash) location.hash = hash; else route(); });
  }
  function route() {
    if (!S.me) return;
    if (sheetOpen) closeSheet(true);
    var r = parseHash();
    var changed = r.name !== S.route, main = $('main');
    var fx = pageFx && Date.now() - pageFx.t < 1500 ? pageFx : null; pageFx = null;
    endPageFx();
    var from = changed && S.route ? $('scr-' + S.route) : null;
    if (from && !from.classList.contains('on')) from = null;   // e.g. coming back from the sign-in gate
    if (from && motionOk()) pinLeaving(from, main); else from = null;
    S.route = r.name; S.arg = r.arg;
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.toggle('on', s.id === 'scr-' + r.name); });
    document.querySelectorAll('.nav button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-go') === NAV_OF[r.name]); });
    var scr = $('scr-' + r.name);
    $('barTitle').textContent = scr.getAttribute('data-title') || '';
    // jump (not smooth-scroll) to the top of the new page: the old page is pinned separately while it leaves
    if (changed) { try { main.scrollTo({ top: 0, behavior: 'instant' }); } catch (e) { main.scrollTop = 0; } }
    setFab(null);
    SCREENS[r.name](scr, r.arg);
    if (changed) animatePage(from, scr, fx);
    if (changed && r.name === 'deploys' && window.ScuffedDeploy) window.ScuffedDeploy.refresh();
  }

  /* ======================================================================= page transitions */

  // Changing page keeps the old page on screen for a moment (.leaving, pinned where you'd scrolled it) while the
  // new one arrives: a slide from its side of the bar for taps, or a wipe for swipes along the bar (navSwipe
  // sets pageFx just before it navigates). Sub-pages of More count as further right, so opening one slides in
  // from the right and Back slides it away again. Reduce motion (Settings, or the phone's own setting) skips it.
  var PAGE_ORDER = ['history', 'board', 'images', 'announce', 'more', 'deploys', 'perms', 'settings'];
  var pageFx = null, fxEnd = null;
  function motionOk() { return !prefs.calm && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function endPageFx() { if (fxEnd) fxEnd(); }
  function pinLeaving(el, main) {
    var sy = main.scrollTop;
    el.classList.add('leaving');
    el.style.height = main.clientHeight + 'px';
    el.scrollTop = sy;
  }
  function animatePage(from, to, fx) {
    if (!motionOk()) return;
    var a = from ? PAGE_ORDER.indexOf(from.id.slice(4)) : -1, b = PAGE_ORDER.indexOf(to.id.slice(4));
    var dir = fx && fx.dir ? fx.dir : (b >= a ? 1 : -1);
    var kind = !from ? 'fade' : fx && fx.kind === 'wipe' ? 'wipe' : 'slide';
    var side = dir > 0 ? 'wipe-r' : 'wipe-l', edge = null;
    to.style.setProperty('--dir', String(dir));
    to.classList.add('enter-' + kind);
    if (from) { from.style.setProperty('--dir', String(dir)); from.classList.add('exit-' + kind); }
    if (kind === 'wipe') {
      to.classList.add(side); from.classList.add(side);
      var m = $('main').getBoundingClientRect(), s = to.getBoundingClientRect();
      edge = h('div', { class: 'wipe-edge ' + side, 'aria-hidden': 'true' });
      edge.style.cssText = 'top:' + m.top + 'px;height:' + m.height + 'px;left:' + s.left + 'px;--w:' + s.width + 'px';
      $('app').appendChild(edge);
    }
    var t = setTimeout(done, kind === 'wipe' ? 540 : kind === 'slide' ? 380 : 300);
    function done() {
      clearTimeout(t);
      if (fxEnd === done) fxEnd = null;
      to.classList.remove('enter-' + kind, 'wipe-r', 'wipe-l'); to.style.removeProperty('--dir');
      if (from) { from.classList.remove('leaving', 'exit-' + kind, 'wipe-r', 'wipe-l'); from.style.height = ''; from.style.removeProperty('--dir'); from.scrollTop = 0; }
      if (edge && edge.parentNode) edge.parentNode.removeChild(edge);
    }
    fxEnd = done;
  }

  // Swipe along the bottom bar (down the side rail on wide screens) to change page. The tab under your finger
  // lights up as you slide, with a tick as you cross each one; letting go opens it with the wipe, sweeping the
  // way your finger went. A short flick that doesn't reach another tab moves one tab over.
  function navSwipe() {
    var nav = $('nav'), btns = Array.prototype.slice.call(nav.querySelectorAll('button')), st = null, swallowAt = 0;
    function vertical() { return nav.offsetHeight > nav.offsetWidth; }
    function tabAt(e) {
      var v = vertical(), p = v ? e.clientY : e.clientX, best = -1;
      btns.forEach(function (b, i) { var r = b.getBoundingClientRect(); if (p >= (v ? r.top : r.left) && p < (v ? r.bottom : r.right)) best = i; });
      if (best < 0) { var f = btns[0].getBoundingClientRect(); best = p < (v ? f.top : f.left) ? 0 : btns.length - 1; }
      return best;
    }
    function current() { var g = NAV_OF[S.route]; for (var i = 0; i < btns.length; i++) if (btns[i].getAttribute('data-go') === g) return i; return -1; }
    function peek(i) { btns.forEach(function (b, j) { b.classList.toggle('peek', j === i); }); }
    function reset() { st = null; nav.classList.remove('swiping'); peek(-1); }
    nav.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      st = { x: e.clientX, y: e.clientY, id: e.pointerId, start: current(), at: -1, moving: false, d: 0 };
    });
    nav.addEventListener('pointermove', function (e) {
      if (!st || e.pointerId !== st.id) return;
      var v = vertical(), cross = v ? e.clientX - st.x : e.clientY - st.y;
      st.d = v ? e.clientY - st.y : e.clientX - st.x;
      if (!st.moving) {
        if (Math.abs(st.d) < 14 || Math.abs(st.d) < Math.abs(cross)) return;
        st.moving = true; nav.classList.add('swiping');
        try { nav.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
      }
      var i = tabAt(e);
      if (i !== st.at) { st.at = i; peek(i); haptic(4); }
    });
    nav.addEventListener('pointerup', function (e) {
      if (!st || e.pointerId !== st.id) return;
      var s = st; reset();
      if (!s.moving) return;
      swallowAt = Date.now();   // the click this swipe ends with isn't a tap
      var to = s.at;
      if (to === s.start && Math.abs(s.d) > 30) to = Math.max(0, Math.min(btns.length - 1, s.start + (s.d > 0 ? 1 : -1)));
      if (to < 0 || to === s.start) return;
      haptic(10);
      pageFx = { kind: 'wipe', dir: s.d > 0 ? 1 : -1, t: Date.now() };
      go(btns[to].getAttribute('data-go'));
    });
    nav.addEventListener('pointercancel', reset);
    nav.addEventListener('click', function (e) { if (Date.now() - swallowAt < 400) { e.stopPropagation(); e.preventDefault(); } }, true);
  }
  function setFab(text, fn, iconName) {
    var f = $('fab');
    f.classList.toggle('hidden', !text);
    if (!text) return;
    $('fabText').textContent = text;
    var use = f.querySelector('use'); if (use) use.setAttribute('href', '#i-' + (iconName || 'plus'));
    f.onclick = function () { haptic(10); fn(); };
  }
  function bigHeader(title, sub, tag) {
    return h('div', { class: 'big' }, h('h1', { text: title }), sub ? h('p', { text: sub }) : null, tag || null);
  }
  function refreshCurrent() { if (S.route === 'deploys' && window.ScuffedDeploy) window.ScuffedDeploy.refresh(); S.loaded[S.route] = 0; route(); }

  /* ======================================================================= Inbox: notification history */

  var hist = { items: null, filter: 'all', open: {} };
  function lastRead() { return Number(load(READ_KEY, 0)) || 0; }
  function unreadCount() { var lr = lastRead(); return (hist.items || []).filter(function (n) { return n.id > lr; }).length; }
  function paintBadges() {
    var n = unreadCount();
    $('navInbox').textContent = n ? String(n > 99 ? '99+' : n) : '';
    $('bellDot').classList.toggle('hidden', !n);
    if (navigator.setAppBadge) { try { if (n) navigator.setAppBadge(n); else navigator.clearAppBadge(); } catch (e) { /* unsupported */ } }
  }
  function loadHistory() {
    return rpc('push_history', { before: 0, max_rows: 120 }).then(function (d) { hist.items = (d && d.items) || []; hist.missing = false; paintBadges(); }, function (e) {
      if (/push_history|function/i.test(errText(e))) { hist.items = []; hist.missing = true; } else throw e;
    });
  }

  function renderHistory(scr) {
    clear(scr);
    scr.appendChild(bigHeader('Notifications', 'Everything scuffed_dev has told you, newest first.',
      h('button', { class: 'tag', type: 'button', html: ic('gear') + 'Choose notifications', style: 'cursor:pointer', onclick: function () { go('settings'); } })));
    scr.appendChild(pushBanner());
    var kinds = [['all', 'All'], ['announce', 'Announcements'], ['world', 'World'], ['board', 'Board']];
    if (isDev()) kinds.push(['deploy', 'Deploys'], ['suggest', 'Suggestions']);
    var chips = h('div', { class: 'chips', role: 'tablist' });
    kinds.forEach(function (k) {
      var n = (hist.items || []).filter(function (x) { return k[0] === 'all' || x.kind === k[0]; }).length;
      chips.appendChild(h('button', { class: 'chip' + (hist.filter === k[0] ? ' on' : ''), type: 'button', role: 'tab', onclick: function () { hist.filter = k[0]; haptic(5); renderHistory(scr); } }, k[1], h('b', { text: String(n) })));
    });
    scr.appendChild(chips);
    keepChips(chips, 'history');
    var box = h('div');
    scr.appendChild(box);
    if (!hist.items) {
      box.appendChild(skeleton(5, 92));
      loadHistory().then(function () { if (S.route === 'history') renderHistory(scr); }, function (e) { clear(box).appendChild(emptyState('!', 'Couldn\'t load notifications', errText(e))); });
      return;
    }
    if (hist.missing) { box.appendChild(emptyState('{ }', 'Notifications aren\'t set up yet', 'The notification history needs the app\'s database update (supabase/migrations/2026-11-28-scuffed-dev-app-push.sql).')); return; }
    var lr = lastRead();
    var list = hist.items.filter(function (x) { return hist.filter === 'all' || x.kind === hist.filter; });
    if (!list.length) { box.appendChild(emptyState('◇', 'Nothing yet', 'World updates, board changes, announcements' + (isDev() ? ', deploys and suggestions' : '') + ' show up here as they happen.')); return; }
    var lastDay = '';
    list.forEach(function (n) {
      var day = new Date(time(n.created_at)).toDateString();
      if (day !== lastDay) {
        lastDay = day;
        var today = new Date().toDateString(), y = new Date(Date.now() - 86400000).toDateString();
        box.appendChild(h('div', { class: 'day', text: day === today ? 'Today' : day === y ? 'Yesterday' : new Date(time(n.created_at)).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) }));
      }
      box.appendChild(noteRow(n, n.id > lr));
    });
    // seen: mark everything read shortly after the list is on screen
    setTimeout(function () {
      if (S.route !== 'history' || !hist.items.length) return;
      var top = hist.items[0].id;
      if (top > lastRead()) { save(READ_KEY, top); paintBadges(); }
    }, 1800);
  }
  function noteRow(n, unread) {
    var open = !!hist.open[n.id];
    var row = h('button', { class: 'note k-' + n.kind + (unread ? ' unread' : '') + (open ? ' open' : ''), type: 'button', 'aria-expanded': String(open) },
      h('span', { class: 'kico', text: KIND_ICON[n.kind] || '•' }),
      h('span', { class: 'nt' }, h('b', { text: String(n.title || '').replace(/^(?:\p{Extended_Pictographic}|️)+\s*/u, '') }), n.body ? h('p', { text: n.body }) : null, h('time', { text: ago(n.created_at), title: fullDate(n.created_at) })));
    row.addEventListener('click', function () {
      hist.open[n.id] = !hist.open[n.id];
      row.classList.toggle('open', !!hist.open[n.id]);
      row.setAttribute('aria-expanded', String(!!hist.open[n.id]));
      haptic(5);
      var r = /#([a-z]+)(?:\/(.*))?$/.exec(n.url || '');
      if (hist.open[n.id] && r && r[1] !== 'history' && !row.querySelector('.btn')) {
        row.querySelector('.nt').appendChild(h('span', { class: 'row', style: 'margin-top:10px' }, h('span', { class: 'btn sm primary', text: 'Open', onclick: function (e) { e.stopPropagation(); go(r[1], r[2] ? decodeURIComponent(r[2]) : ''); } })));
      }
    });
    return row;
  }

  /* ======================================================================= push notifications */

  var push = { supported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window, sub: null, server: null };
  function b64ToBytes(b) { var s = (b + '==='.slice((b.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
  function deviceLabel() {
    var ua = navigator.userAgent, m = /Android [\d.]+; ([^;)]+)/.exec(ua);
    var dev = m ? m[1].replace(/ Build.*/, '').trim() : /iPhone/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Browser';
    return (dev + (matchMedia('(display-mode: standalone)').matches ? ' · app' : ' · browser')).slice(0, 160);
  }
  function swReady() { return navigator.serviceWorker ? navigator.serviceWorker.ready : Promise.reject(new Error('no service worker')); }
  function currentSub() { if (!push.supported) return Promise.resolve(null); return swReady().then(function (r) { return r.pushManager.getSubscription(); }).then(function (s) { push.sub = s; return s; }, function () { return null; }); }
  function registerSub(sub) {
    var j = sub.toJSON();
    return rpc('push_subscribe', { sub_endpoint: j.endpoint, sub_p256dh: j.keys.p256dh, sub_auth: j.keys.auth, sub_prefs: prefs.kinds, sub_device: deviceLabel() });
  }
  function enablePush() {
    if (!push.supported) { toast('This browser can\'t do push notifications. Install the app, or use Chrome.', 'bad'); return Promise.resolve(false); }
    return Notification.requestPermission().then(function (p) {
      if (p !== 'granted') { toast('Notifications are blocked. Allow them for scuffed_dev in your phone settings.', 'bad'); return false; }
      return worker('/push/key').then(function (k) {
        if (!k.key) throw new Error('Notifications aren\'t switched on on the server yet.');
        return swReady().then(function (reg) {
          return reg.pushManager.getSubscription().then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(k.key) }); });
        });
      }).then(function (sub) { push.sub = sub; return registerSub(sub); }).then(function () { toast('Notifications on for this phone.', 'good'); haptic(15); return true; });
    }).catch(function (e) { toast(errText(e), 'bad'); return false; });
  }
  function disablePush() {
    return currentSub().then(function (s) {
      if (!s) return;
      var ep = s.endpoint;
      return s.unsubscribe().then(function () { return S.client.rpc('push_unsubscribe', { sub_endpoint: ep }); });
    }).then(function () { push.sub = null; toast('Notifications off for this phone.'); }, function (e) { toast(errText(e), 'bad'); });
  }
  // what you can be notified about (developers also get deploys and suggestions); the Worker checks levels too
  function notifKinds() {
    var k = [['announce', 'Announcements', 'The full announcement, when one is saved'], ['world', 'World updates', 'A new PC or Quest build of Scuffed or Straya is up'], ['board', 'Dev board', 'New cards, claims, status changes, notes']];
    if (isDev()) k.push(['deploy', 'Deploys', 'Live on kanaris-beans.com, or a failed build'], ['suggest', 'Suggestions', 'New image and board suggestions']);
    return k;
  }
  var KIND_ICONS = { announce: 'megaphone', world: 'globe', board: 'board', deploy: 'rocket', suggest: 'image' };
  // one switch per kind; saved on this phone and sent to the server with the subscription
  function kindToggles() {
    return notifKinds().map(function (k) {
      return settingRow(KIND_ICONS[k[0]], k[1], k[2], sw(prefs.kinds[k[0]] !== false, function (v) {
        prefs.kinds[k[0]] = v; savePrefs();
        if (push.sub) registerSub(push.sub).catch(function (e) { toast(errText(e), 'bad'); });
      }));
    });
  }

  // First launch: a short spotlight tour of the app (once per phone; Settings > Feel > App tour replays it). The
  // notifications welcome below follows when it ends.
  var TOUR_KEY = 'scd-app-toured';
  function maybeTour(next) { if (load(TOUR_KEY, 0) || sheetOpen) next(); else startTour(next); }
  function startTour(next) {
    if ($('tour')) return;
    var steps = [
      { title: 'Welcome to scuffed_dev', text: 'Everything for running Scuffed, in your pocket. Here\'s a 20 second look around.' },
      { el: 'nav', title: 'Your sections', text: 'Inbox, Board, Images, Announcements and More. Tap one, or slide your finger along the bar to whip between them.', finger: true },
      { el: 'barBell', title: 'Notifications', text: 'Everything scuffed_dev tells you lands in your Inbox. A dot here means something new.' },
      { el: 'barAction', title: 'Refresh', text: 'Tap here, or pull down on any page, to get the latest.' },
      { el: 'meBtn', title: 'Make it yours', text: 'Your account and Settings: choose what you get notified about, and change the look with backgrounds, your own custom gradient and accent colours. You can replay this tour there too.' }
    ];
    var i = 0, card = null, finger = null, pad = 6;
    var root = h('div', { class: 'tour', id: 'tour', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'App tour' });
    var hole = h('div', { class: 'tour-hole none' });
    root.appendChild(hole);
    document.body.appendChild(root);
    function show() {
      var s = steps[i], el = s.el ? $(s.el) : null;
      if (el && !el.offsetWidth) el = null;
      if (card) root.removeChild(card);
      if (finger) { root.removeChild(finger); finger = null; }
      var r = el ? el.getBoundingClientRect() : null;
      if (r) {
        hole.classList.remove('none');
        hole.style.cssText = 'top:' + (r.top - pad) + 'px;left:' + (r.left - pad) + 'px;width:' + (r.width + pad * 2) + 'px;height:' + (r.height + pad * 2) + 'px;border-radius:' + (el.id === 'meBtn' ? '50%' : '18px');
      } else { hole.classList.add('none'); hole.style.cssText = 'top:50%;left:50%;width:0;height:0'; }
      var last = i === steps.length - 1, dots = h('div', { class: 'tour-dots' });
      steps.forEach(function (x, j) { dots.appendChild(h('i', { class: j === i ? 'on' : null })); });
      card = h('div', { class: 'tour-card' }, h('div', { class: 'step', text: (i + 1) + ' / ' + steps.length }), h('h3', { text: s.title }), h('p', { text: s.text }),
        h('div', { class: 'tour-foot' }, dots,
          last ? null : h('button', { class: 'btn sm', type: 'button', text: 'Skip', onclick: finish }),
          h('button', { class: 'btn sm primary', type: 'button', text: last ? 'Let\'s go' : 'Next', onclick: function () { haptic(6); i++; if (i >= steps.length) finish(); else show(); } })));
      root.appendChild(card);
      // the card sits on the far side of the spotlight from its target; centred when there's no target or the
      // target is the tall side rail (wide screens)
      if (!r || r.height > innerHeight * 0.6) {
        card.style.top = Math.max(16, (innerHeight - card.offsetHeight) / 2) + 'px';
        if (r) { card.style.left = (r.right + pad + 18) + 'px'; card.style.margin = '0'; }
      } else if (r.top + r.height / 2 > innerHeight / 2) card.style.bottom = (innerHeight - r.top + pad + 14) + 'px';
      else card.style.top = (r.bottom + pad + 14) + 'px';
      if (s.finger && r) {
        var b = el.querySelectorAll('button'), f0 = b[0].getBoundingClientRect(), f1 = b[b.length - 1].getBoundingClientRect(), v = r.height > r.width;
        finger = h('div', { class: 'tour-finger' + (v ? ' v' : '') });
        finger.style.left = (f0.left + f0.width / 2) + 'px';
        finger.style.top = (f0.top + f0.height / 2) + 'px';
        finger.style.setProperty('--travel', (v ? f1.top - f0.top : f1.left - f0.left) + 'px');
        root.insertBefore(finger, card);
      }
    }
    function finish() {
      save(TOUR_KEY, 1);
      window.removeEventListener('resize', show);
      root.classList.add('out');
      setTimeout(function () { if (root.parentNode) root.parentNode.removeChild(root); }, 260);
      if (next) setTimeout(next, 380);
    }
    window.addEventListener('resize', show);
    show();
  }

  // First launch after signing in: ask for notifications (and say what they'll be about). Shown once per phone;
  // the camera is only asked for when you scan a sign-in QR.
  var WELCOME_KEY = 'scd-app-welcomed';
  function maybeWelcome() {
    if (load(WELCOME_KEY, 0) || sheetOpen) return;
    var ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    currentSub().then(function (sub) {
      if (sub || (push.supported && Notification.permission === 'denied')) { save(WELCOME_KEY, 1); return; }
      var done = function () { save(WELCOME_KEY, 1); };
      var body = h('div', null, h('p', { style: 'margin:0 0 12px;color:var(--ink2)', text: 'scuffed_dev can tell you when things happen, even when the app is closed. Pick what you want: you can change it any time in Settings.' }));
      if (ios && !standalone) {
        body.appendChild(h('div', { class: 'panel', style: 'padding:14px' }, h('b', { text: 'First, add it to your Home Screen' }),
          h('div', { style: 'color:var(--ink3);font-size:.84rem;margin-top:4px', text: 'On iPhone, notifications only work from the Home Screen app: tap Share, then Add to Home Screen, and open scuffed_dev from there.' })));
        openSheet('Welcome to scuffed_dev', body, [h('button', { class: 'btn primary block', type: 'button', text: 'Got it', onclick: function () { closeSheet(); } })], done);
        return;
      }
      if (!push.supported) { done(); return; }
      body.appendChild(h('div', { class: 'panel' }, kindToggles()));
      body.appendChild(h('p', { style: 'margin:12px 2px 0;color:var(--ink3);font-size:.8rem', text: 'Android will ask to allow notifications next. The camera is only used when you scan a sign-in QR.' }));
      openSheet('Welcome to scuffed_dev', body, [
        h('button', { class: 'btn', type: 'button', text: 'Not now', onclick: function () { closeSheet(); toast('You can turn notifications on in Settings any time.'); } }),
        h('button', { class: 'btn primary', type: 'button', html: ic('bell') + 'Turn on notifications', onclick: function () { closeSheet(); enablePush().then(function (ok) { if (ok && S.route === 'history') renderHistory($('scr-history')); }); } })
      ], done);
    });
  }

  function pushBanner() {
    var box = h('div');
    var ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (ios && !standalone) {
      // iOS only allows web notifications for apps added to the Home Screen
      box.appendChild(h('div', { class: 'panel', style: 'padding:14px;margin-bottom:14px' },
        h('b', { text: 'Add scuffed_dev to your Home Screen' }),
        h('div', { style: 'color:var(--ink3);font-size:.82rem;margin-top:4px', text: 'On iPhone, notifications only work from the Home Screen app: tap Share, then Add to Home Screen, then open scuffed_dev from there.' })));
      return box;
    }
    currentSub().then(function (s) {
      if (s || !push.supported) return;
      box.appendChild(h('div', { class: 'panel', style: 'padding:14px;margin-bottom:14px;display:flex;gap:12px;align-items:center' },
        h('span', { class: 'kico', html: ic('bell').replace('<svg', '<svg width="22" height="22"'), style: 'display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:var(--gloss),var(--fill);color:#fff;flex:none' }),
        h('div', { style: 'flex:1;min-width:0' }, h('b', { text: 'Turn on notifications' }), h('div', { style: 'color:var(--ink3);font-size:.8rem', text: isDev() ? 'World updates, deploys, suggestions, the board and announcements.' : 'World updates, the board and announcements.' })),
        h('button', { class: 'btn sm primary', type: 'button', text: 'Turn on', onclick: function () { enablePush().then(function (ok) { if (ok) clear(box); }); } })));
    });
    return box;
  }

  /* ======================================================================= Board */

  var board = { data: null, filter: 'active', q: '' };
  function person(uid, fb) { var p = board.data && board.data.people && board.data.people[uid]; return { id: uid, name: (p && p.name) || fb || 'Someone', avatar: (p && p.avatar) || null }; }
  function avatarEl(p, size) {
    var a = h('span', { class: 'avatar', title: p.name });
    if (size) { a.style.width = a.style.height = size + 'px'; }
    if (p.avatar && /^data:image\//.test(p.avatar)) a.appendChild(h('img', { src: p.avatar, alt: '' })); else a.textContent = String(p.name || '?').charAt(0).toUpperCase();
    return a;
  }
  function statusTag(s) { var t = ST[s] || ST.unclaimed; return h('span', { class: 'tagx status st-' + s }, h('i', { text: t.sym }), t.label); }
  function loadBoard() { return rpc('devboard_list').then(function (d) { d.items = d.items || []; board.data = d; paintBoardBadge(); }); }
  function paintBoardBadge() {
    if (!board.data || !S.me) return;
    var mine = board.data.items.filter(function (it) { return S.me.id && it.assignee === S.me.id && it.status !== 'complete'; }).length;
    $('navBoard').textContent = mine ? String(mine) : '';
  }

  function renderBoard(scr, arg) {
    clear(scr);
    scr.appendChild(bigHeader('Dev board', 'Tasks and suggestions for the Scuffed world.'));
    if (isAdmin()) setFab(isDev() ? 'New card' : 'Suggest', newCardSheet);
    var box = h('div');
    if (!board.data) {
      scr.appendChild(box); box.appendChild(skeleton(4, 104));
      loadBoard().then(function () { if (S.route === 'board') renderBoard(scr, arg); }, function (e) { clear(box).appendChild(emptyState('!', 'Couldn\'t load the board', errText(e))); });
      return;
    }
    var items = board.data.items;
    var F = [
      ['active', 'Active', function (it) { return it.status !== 'complete'; }],
      ['mine', 'Mine', function (it) { return S.me.id && it.assignee === S.me.id; }]
    ].concat(STATUSES.map(function (s) { return [s.id, s.label, function (it) { return it.status === s.id && it.kind === 'task'; }]; }))
      .concat([['suggestion', 'Suggestions', function (it) { return it.kind === 'suggestion' && it.status !== 'complete'; }]]);
    var chips = h('div', { class: 'chips' });
    F.forEach(function (f) {
      chips.appendChild(h('button', { class: 'chip' + (board.filter === f[0] ? ' on' : ''), type: 'button', onclick: function () { board.filter = f[0]; haptic(5); renderBoard(scr); } }, f[1], h('b', { text: String(items.filter(f[2]).length) })));
    });
    var search = h('input', { class: 'input', type: 'search', placeholder: 'Search cards', value: board.q, 'aria-label': 'Search cards' });
    scr.appendChild(h('div', { class: 'search' }, icon('search'), search));
    scr.appendChild(chips);
    keepChips(chips, 'board');
    scr.appendChild(box);
    var fn =(F.filter(function (f) { return f[0] === board.filter; })[0] || F[0])[2];
    function draw() {
      clear(box);
      var q = board.q.trim().toLowerCase();
      var list = items.filter(fn).filter(function (it) { return !q || (it.title + ' ' + it.body + ' #' + it.id).toLowerCase().indexOf(q) >= 0; })
        .sort(function (a, b) { return (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1) || time(b.updated_at) - time(a.updated_at); });
      if (!list.length) { box.appendChild(emptyState('□', q ? 'No cards match' : 'Nothing here', q ? 'Try another search.' : 'Pick another filter, or add a card.')); return; }
      var ul = h('div', { class: 'list' });
      list.forEach(function (it) { ul.appendChild(cardRow(it)); });
      box.appendChild(ul);
    }
    search.addEventListener('input', function () { board.q = search.value; draw(); });
    draw();
    if (arg) { var it = items.filter(function (x) { return String(x.id) === String(arg); })[0]; if (it) setTimeout(function () { openCard(it); }, 60); }
  }
  function cardRow(it) {
    var who = it.assignee ? person(it.assignee) : null;
    return h('button', { class: 'kcard st-' + it.status, type: 'button', onclick: function () { openCard(it); } },
      h('div', { class: 'top' }, h('span', { class: 'tagx', text: '#' + it.id }), statusTag(it.status), it.kind === 'suggestion' ? h('span', { class: 'tagx sug', text: 'Suggestion' }) : null, it.priority === 'high' ? h('span', { class: 'tagx hi', text: 'High' }) : null),
      h('h3', { text: it.title }),
      h('div', { class: 'meta' }, h('span', { class: 'row', style: 'gap:6px' }, who ? avatarEl(who, 18) : null, who ? who.name : 'Unassigned'), h('span', { text: (it.notes ? plural(it.notes, 'note') + ' · ' : '') + ago(it.updated_at) })));
  }
  function openCard(it) {
    var body = h('div');
    var who = it.assignee ? person(it.assignee) : null;
    body.appendChild(h('div', { class: 'row wrap', style: 'gap:6px;margin-bottom:10px' }, statusTag(it.status), it.kind === 'suggestion' ? h('span', { class: 'tagx sug', text: 'Suggestion' }) : null, it.priority !== 'normal' ? h('span', { class: 'tagx' + (it.priority === 'high' ? ' hi' : ''), text: it.priority === 'high' ? 'High priority' : 'Low priority' }) : null));
    if (it.body) body.appendChild(h('p', { text: it.body, style: 'margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ink2)' }));
    body.appendChild(h('dl', { class: 'kv' },
      h('dt', { text: 'Assigned' }), h('dd', { class: 'row', style: 'gap:8px' }, who ? avatarEl(who, 22) : null, who ? who.name : 'Nobody yet'),
      h('dt', { text: 'Added by' }), h('dd', { text: (it.created_by_name || 'Someone') + ' · ' + ago(it.created_at) }),
      h('dt', { text: 'Updated' }), h('dd', { text: (it.updated_by_name ? it.updated_by_name + ' · ' : '') + ago(it.updated_at) })));
    if (isDev()) {
      body.appendChild(h('div', { class: 'section', text: 'Status' }));
      var grid = h('div', { class: 'statusgrid' });
      STATUSES.forEach(function (s) {
        grid.appendChild(h('button', { class: 'st-' + s.id + (it.status === s.id ? ' on' : ''), type: 'button', onclick: function () {
          if (it.status === s.id) return;
          haptic(10);
          rpc('devboard_set_status', { item: it.id, new_status: s.id }).then(function () { toast('#' + it.id + ' → ' + s.label, 'good'); afterBoardChange(it.id); }, function (e) { toast(errText(e), 'bad'); });
        } }, s.sym + ' ' + s.label));
      });
      body.appendChild(grid);
      var row = h('div', { class: 'row wrap', style: 'margin-top:10px' });
      if (S.me.id && it.assignee !== S.me.id) row.appendChild(h('button', { class: 'btn sm primary', type: 'button', html: ic('hand') + 'Claim', onclick: function () { rpc('devboard_assign', { item: it.id, who: S.me.id }).then(function () { toast('You\'re on #' + it.id, 'good'); afterBoardChange(it.id); }, function (e) { toast(errText(e), 'bad'); }); } }));
      if (it.kind === 'suggestion') row.appendChild(h('button', { class: 'btn sm', type: 'button', text: 'Make it a task', onclick: function () { rpc('devboard_set_kind', { item: it.id, new_kind: 'task' }).then(function () { toast('Now a task', 'good'); afterBoardChange(it.id); }, function (e) { toast(errText(e), 'bad'); }); } }));
      row.appendChild(h('button', { class: 'btn sm ghost', type: 'button', html: ic('trash') + 'Delete', onclick: function () {
        confirmSheet('Delete #' + it.id + '?', '“' + it.title + '” and its notes are deleted for everyone.', 'Delete', true).then(function (ok) {
          if (ok) rpc('devboard_delete', { item: it.id }).then(function () { toast('Deleted #' + it.id); board.data = null; route(); }, function (e) { toast(errText(e), 'bad'); });
        });
      } }));
      body.appendChild(row);
    }
    body.appendChild(h('div', { class: 'section', text: 'Timeline' }));
    var tl = h('ul', { class: 'timeline' }, h('li', null, h('div', { class: 'skel', style: 'height:48px;flex:1' })));
    body.appendChild(tl);
    rpc('devboard_updates', { item: it.id }).then(function (ups) {
      clear(tl);
      (ups || []).slice().reverse().forEach(function (u) {
        var p = person(u.author, u.author_name);
        tl.appendChild(h('li', { class: u.kind === 'event' ? 'ev' : '' }, u.kind === 'note' ? avatarEl(p, 28) : null,
          h('div', { class: 'tb' }, h('small', { text: (u.author_name || 'Someone') + ' · ' + ago(u.created_at) }), u.body)));
      });
      if (!tl.childNodes.length) tl.appendChild(h('li', { class: 'ev' }, h('div', { class: 'tb', text: 'No activity yet.' })));
    }, function (e) { clear(tl).appendChild(h('li', { class: 'ev' }, h('div', { class: 'tb', text: errText(e) }))); });
    var foot = null;
    if (isAdmin()) {
      var note = h('input', { class: 'input', placeholder: 'Add a note…', maxlength: '2000', 'aria-label': 'Add a note' });
      var send = function () {
        var v = note.value.trim(); if (!v) return;
        haptic(10);
        rpc('devboard_note', { item: it.id, note: v }).then(function () { note.value = ''; toast('Note posted', 'good'); afterBoardChange(it.id); }, function (e) { toast(errText(e), 'bad'); });
      };
      note.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
      foot = [note, h('button', { class: 'btn primary', type: 'button', html: ic('send'), 'aria-label': 'Post note', style: 'flex:none;width:52px;padding:0', onclick: send })];
    }
    openSheet('#' + it.id + ' ' + it.title, body, foot);
  }
  function afterBoardChange(id) {
    loadBoard().then(function () {
      var it = board.data.items.filter(function (x) { return x.id === id; })[0];
      if (S.route === 'board') renderBoard($('scr-board'));
      if (it) openCard(it);
    });
  }
  function newCardSheet() {
    var kind = isDev() ? 'task' : 'suggestion', prio = 'normal';
    var title = h('input', { class: 'input', maxlength: '120', placeholder: 'What needs doing?' });
    var body = h('textarea', { class: 'textarea', maxlength: '4000', placeholder: 'Details (optional)' });
    var kindSeg = h('div', { class: 'chips', style: 'margin-bottom:6px' });
    function paintKind() {
      var keepX = kindSeg.scrollLeft;  // emptying the bar clamps its scroll to 0, so put it back after
      clear(kindSeg);
      (isDev() ? [['task', 'Task'], ['suggestion', 'Suggestion']] : [['suggestion', 'Suggestion']]).forEach(function (k) {
        kindSeg.appendChild(h('button', { class: 'chip' + (kind === k[0] ? ' on' : ''), type: 'button', text: k[1], onclick: function () { kind = k[0]; paintKind(); } }));
      });
      [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']].forEach(function (p) {
        kindSeg.appendChild(h('button', { class: 'chip' + (prio === p[0] ? ' on' : ''), type: 'button', text: p[1] + ' priority', onclick: function () { prio = p[0]; paintKind(); } }));
      });
      kindSeg.scrollLeft = keepX;
    }
    paintKind();
    var create = h('button', { class: 'btn primary', type: 'button', text: 'Add card', onclick: function () {
      if (!title.value.trim()) { toast('Give it a title first.', 'bad'); return; }
      create.disabled = true;
      rpc('devboard_create', { item_kind: kind, item_title: title.value.trim(), item_body: body.value.trim(), item_priority: prio }).then(function (id) {
        closeSheet(); toast('Added #' + id, 'good'); haptic(15);
        board.data = null; board.filter = kind === 'suggestion' ? 'suggestion' : 'active'; go('board', String(id));
      }, function (e) { create.disabled = false; toast(errText(e), 'bad'); });
    } });
    openSheet(isDev() ? 'New card' : 'Suggest something', [kindSeg, h('label', { class: 'field' }, h('span', { text: 'Title' }), title), h('label', { class: 'field' }, h('span', { text: 'Details' }), body)],
      [h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: function () { closeSheet(); } }), create]);
    setTimeout(function () { title.focus(); }, 320);
  }

  /* ======================================================================= Images */

  var imgs = { data: null, folder: null, pending: [] };
  var KNOWN_FOLDERS = { posters: 'Posters', players: 'Players', scuffed: 'Scuffed', events: 'Events', ads: 'Ads' };
  var SUGG = '@suggestions';
  function folderOf(p) { return p.split('/')[0]; }
  function nameOf(p) { return p.split('/').slice(1).join('/'); }
  function folderLabel(f) { return f === SUGG ? 'Suggestions' : KNOWN_FOLDERS[f] || (f.charAt(0).toUpperCase() + f.slice(1)); }
  function rawFor(p) { return RAW + imgs.data.head + '/scuffed/images/' + p; }
  function worldUrl(p) { return SITE + '/scuffed/images/' + p; }

  // the website's picture cache (scuffed_dev/images.js): same Cache Storage, keyed by git blob sha, shared with it
  var PIC_CACHE = 'scd-images-pics-v1', pics = {}, picWait = {}, picBusy = {};
  function picKey(sha) { return 'https://scd-pics.invalid/' + sha; }
  function setPic(img, sha, url) {
    img.setAttribute('data-sha', sha || '');
    if (sha && pics[sha]) { if (img.getAttribute('src') !== pics[sha]) img.src = pics[sha]; img.classList.remove('loading'); return; }
    if (!sha) { if (url) img.src = url; return; }
    img.classList.add('loading');
    (picWait[sha] = picWait[sha] || []).push(img);
    if (picBusy[sha] || !url) return;
    picBusy[sha] = true;
    var done = function (src) { delete picBusy[sha]; (picWait[sha] || []).forEach(function (i) { if (i.getAttribute('data-sha') === sha) { i.src = src; i.classList.remove('loading'); } }); delete picWait[sha]; };
    var net = function (c) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); if (c) c.put(picKey(sha), r.clone()).catch(function () {}); return r.blob(); }); };
    (window.caches ? caches.open(PIC_CACHE).then(function (c) { return c.match(picKey(sha)).then(function (hit) { return hit ? hit.blob() : net(c); }); }) : net(null))
      .then(function (b) { pics[sha] = URL.createObjectURL(b); done(pics[sha]); }, function () { done(url); });
  }
  function rememberPic(sha, blob) { if (!sha || !blob || pics[sha]) return; pics[sha] = URL.createObjectURL(blob); if (window.caches) caches.open(PIC_CACHE).then(function (c) { return c.put(picKey(sha), new Response(blob, { headers: { 'Content-Type': 'image/png' } })); }).catch(function () {}); }

  function loadImages() {
    return worker('/images').then(function (d) {
      var files = {};
      (d.files || []).forEach(function (f) { if (/\.png$/i.test(f.path) && f.path.indexOf('/') > 0) files[f.path] = f; });
      imgs.data = { head: d.head, files: files, manifest: d.manifest || {}, suggestions: d.suggestions || [], suggestHead: d.suggestHead };
      $('navImages').textContent = isDev() && imgs.data.suggestions.length ? String(imgs.data.suggestions.length) : '';
    });
  }
  function folders() {
    var set = {};
    Object.keys(imgs.data.files).forEach(function (p) { set[folderOf(p)] = 1; });
    var known = Object.keys(KNOWN_FOLDERS).filter(function (f) { return set[f]; });
    return known.concat(Object.keys(set).filter(function (f) { return !KNOWN_FOLDERS[f]; }).sort());
  }
  function inFolder(f) { return Object.keys(imgs.data.files).filter(function (p) { return folderOf(p) === f; }).sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }); }); }

  function renderImages(scr, arg) {
    clear(scr);
    scr.appendChild(bigHeader('World images', isDev() ? 'Upload, replace, crop and review what the world shows.' : 'Suggest pictures; a developer approves them.'));
    var box = h('div');
    if (!imgs.data) {
      scr.appendChild(box); box.appendChild(skeleton(2, 150));
      loadImages().then(function () { if (S.route === 'images') renderImages(scr, arg); }, function (e) { clear(box).appendChild(emptyState('!', 'Couldn\'t load images', errText(e))); });
      return;
    }
    if (arg === 'suggestions') imgs.folder = SUGG;
    var fs = folders();
    if (!imgs.folder || (imgs.folder !== SUGG && fs.indexOf(imgs.folder) < 0)) imgs.folder = fs[0] || 'posters';
    var chips = h('div', { class: 'chips' });
    fs.forEach(function (f) { chips.appendChild(h('button', { class: 'chip' + (imgs.folder === f ? ' on' : ''), type: 'button', onclick: function () { imgs.folder = f; haptic(5); renderImages(scr); } }, folderLabel(f), h('b', { text: String(inFolder(f).length) }))); });
    chips.appendChild(h('button', { class: 'chip' + (imgs.folder === SUGG ? ' on' : ''), type: 'button', onclick: function () { imgs.folder = SUGG; renderImages(scr); } }, '💡 Suggestions', h('b', { text: String(imgs.data.suggestions.length) })));
    scr.appendChild(chips);
    keepChips(chips, 'images');
    scr.appendChild(box);
    if (isAdmin() && imgs.folder !== SUGG) setFab(isDev() ? 'Upload' : 'Suggest', function () { pickFiles(null); }, 'upload');
    if (imgs.folder === SUGG) return drawSuggestions(box);
    var list = inFolder(imgs.folder);
    var grid = h('div', { class: 'grid' });
    imgs.pending.filter(function (it) { return it.folder === imgs.folder; }).forEach(function (it) {
      var pic = h('span', { class: 'pic', 'data-state': it.state });
      if (it.url) pic.appendChild(h('img', { src: it.url, alt: '' }));
      grid.appendChild(h('div', { class: 'tile pending' }, pic, h('span', { class: 'nm', text: it.name })));
    });
    list.forEach(function (p) {
      var f = imgs.data.files[p];
      var img = h('img', { alt: nameOf(p), decoding: 'async' });
      setPic(img, f.sha, rawFor(p));
      var waiting = imgs.data.suggestions.filter(function (s) { return s.path === p; }).length;
      grid.appendChild(h('button', { class: 'tile', type: 'button', onclick: function () { openImage(p); } }, h('span', { class: 'pic' }, img), waiting ? h('span', { class: 'sugdot', text: '💡' + waiting }) : null, h('span', { class: 'nm', text: nameOf(p) })));
    });
    if (!grid.childNodes.length) box.appendChild(emptyState('▢', 'This folder is empty', isAdmin() ? 'Tap ' + (isDev() ? 'Upload' : 'Suggest') + ' to add a picture.' : ''));
    else box.appendChild(grid);
  }
  function openImage(p) {
    var f = imgs.data.files[p]; if (!f) return;
    var m = imgs.data.manifest[p] || {};
    var img = h('img', { alt: nameOf(p) });
    setPic(img, f.sha, rawFor(p));
    var url = worldUrl(p);
    var body = [h('div', { class: 'bigpic' }, img), h('dl', { class: 'kv' },
      h('dt', { text: 'Size' }), h('dd', { text: (m.w ? m.w + ' × ' + m.h + ' px · ' : '') + kb(f.size) }),
      m.by ? h('dt', { text: m.approvedBy ? 'Suggested' : 'Uploaded' }) : null, m.by ? h('dd', { text: m.by + (m.at ? ' · ' + ago(m.at) : '') }) : null,
      m.approvedBy ? h('dt', { text: 'Approved' }) : null, m.approvedBy ? h('dd', { text: m.approvedBy }) : null,
      m.from || m.placeholder ? h('dt', { text: 'From' }) : null, m.from || m.placeholder ? h('dd', { text: m.placeholder ? 'Placeholder poster' : m.from }) : null),
      h('div', { class: 'row', style: 'margin-bottom:6px' }, h('input', { class: 'input grow', value: url, readonly: true, 'aria-label': 'World URL', style: 'font-family:var(--mono);font-size:13px' }),
        h('button', { class: 'btn', type: 'button', html: ic('copy'), 'aria-label': 'Copy world URL', style: 'flex:none;width:52px;padding:0', onclick: function () { copyText(url); } }))];
    var foot = [];
    if (isAdmin()) {
      foot.push(h('button', { class: 'btn primary', type: 'button', html: ic('upload') + (isDev() ? 'Replace' : 'Suggest'), onclick: function () { closeSheet(); pickFiles(p); } }));
      foot.push(h('button', { class: 'btn', type: 'button', html: ic('crop') + 'Crop', onclick: function () { closeSheet(); recrop(p); } }));
    }
    if (isDev()) {
      body.push(h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'btn sm', type: 'button', html: ic('edit') + 'Rename', onclick: function () { renameImage(p); } }),
        h('button', { class: 'btn sm ghost', type: 'button', html: ic('trash') + 'Delete', style: 'color:var(--bad)', onclick: function () { deleteImage(p); } })));
    }
    openSheet(nameOf(p), body, foot);
  }
  function copyText(t) {
    (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Copied', 'good'); haptic(8); }, function () { promptSheet('Copy this', 'URL', t, 'Done'); });
  }
  function imageSave(ops, label) {
    return worker('/images', { ops: ops }).then(function (res) { watchDeploy(res, label); toast(label + ': saved', 'good'); haptic(15); return res; });
  }
  function renameImage(p) {
    var f = imgs.data.files[p];
    promptSheet('Rename ' + nameOf(p), 'New name', nameOf(p).replace(/\.png$/, ''), 'Rename', function (v) {
      var s = v.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(s)) return 'Lowercase letters, numbers, - and _.';
      if (imgs.data.files[folderOf(p) + '/' + s + '.png']) return 'That name is taken.';
      return null;
    }).then(function (v) {
      if (!v) return;
      var to = folderOf(p) + '/' + v.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') + '.png';
      imageSave([{ op: 'move', path: p, to: to, sha: f.sha }], 'Rename ' + nameOf(p)).then(function () { imgs.data = null; route(); }, function (e) { toast(errText(e), 'bad'); });
    });
  }
  function deleteImage(p) {
    var f = imgs.data.files[p];
    confirmSheet('Delete ' + nameOf(p) + '?', 'The world stops finding it at its address. Old versions stay in the site\'s history on GitHub.', 'Delete', true).then(function (ok) {
      if (!ok) return;
      closeSheet();
      imageSave([{ op: 'delete', path: p, sha: f.sha }], 'Delete ' + nameOf(p)).then(function () { imgs.data = null; route(); }, function (e) { toast(errText(e), 'bad'); });
    });
  }
  function drawSuggestions(box) {
    var list = imgs.data.suggestions;
    if (!list.length) { box.appendChild(emptyState('💡', 'No suggestions waiting', 'When an admin suggests a picture it shows up here.')); return; }
    var ul = h('div', { class: 'list' });
    list.forEach(function (s) {
      var cur = imgs.data.files[s.path];
      var before = h('span', { class: 'pic' }); if (cur) { var bi = h('img', { alt: '' }); setPic(bi, cur.sha, rawFor(s.path)); before.appendChild(bi); } else before.appendChild(h('b', { text: '+', style: 'font-size:2rem;color:var(--ink3)' }));
      var after = h('span', { class: 'pic' }); var ai = h('img', { alt: '' }); setPic(ai, s.blob, imgs.data.suggestHead ? RAW + imgs.data.suggestHead + '/' + s.file : ''); after.appendChild(ai);
      var mine = S.me && s.by === S.me.name;
      var acts = h('div', { class: 'row wrap', style: 'margin-top:10px' });
      if (isDev()) {
        acts.appendChild(h('button', { class: 'btn sm primary', type: 'button', html: ic('check') + 'Approve', onclick: function () { review(s, 'approve'); } }));
        acts.appendChild(h('button', { class: 'btn sm', type: 'button', text: 'Reject', onclick: function () { promptSheet('Reject this suggestion?', 'Reason (optional)', '', 'Reject').then(function (r) { if (r !== null) review(s, 'reject', r); }); } }));
      } else if (mine) acts.appendChild(h('button', { class: 'btn sm', type: 'button', text: 'Withdraw', onclick: function () { review(s, 'withdraw'); } }));
      ul.appendChild(h('div', { class: 'panel', style: 'padding:14px' },
        h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, h('b', { text: s.path, style: 'font-family:var(--mono);font-size:.86rem' }), h('span', { class: 'tagx' + (s.sha ? '' : ' sug'), text: s.sha ? 'Replacement' : 'New' })),
        h('div', { class: 'pair' }, before, h('span', { class: 'arrow', text: '→' }), after),
        h('p', { style: 'margin:10px 0 0;color:var(--ink3);font-size:.8rem', text: s.by + ' · ' + ago(s.at) + (s.from ? ' · ' + s.from : '') }),
        s.note ? h('p', { style: 'margin:6px 0 0;font-style:italic;color:var(--ink2)', text: '“' + s.note + '”' }) : null, acts));
    });
    box.appendChild(ul);
  }
  function review(s, action, reason, force) {
    worker('/images/review', { id: s.id, action: action, reason: reason || '', force: !!force }).then(function (res) {
      if (action === 'approve') watchDeploy(res, 'Approved ' + s.path);
      toast({ approve: 'Approved: it\'s going live', reject: 'Rejected', withdraw: 'Withdrawn' }[action], 'good');
      imgs.data = null; route();
    }, function (e) {
      if (e.code === 'slot-changed' && !force) return confirmSheet('The picture changed since', errText(e), 'Approve anyway').then(function (ok) { if (ok) review(s, action, reason, true); });
      toast(errText(e), 'bad');
    });
  }

  // upload: pick -> crop & confirm (the website's cropper) -> convert to PNG -> save (devs) or suggest (admins)
  var pickTarget = null;
  function pickFiles(target) { pickTarget = target; var f = $('filePick'); f.multiple = !target; f.value = ''; f.click(); }
  function recrop(p) {
    toast('Opening the cropper…');
    fetch(imgs.data && pics[imgs.data.files[p].sha] ? pics[imgs.data.files[p].sha] : rawFor(p)).then(function (r) { return r.blob(); }).then(function (b) {
      startUpload([new File([b], nameOf(p), { type: 'image/png' })], p, true);
    }, function (e) { toast('Couldn\'t open it: ' + errText(e), 'bad'); });
  }
  function newPath(folder, original, taken) {
    var used = {}; inFolder(folder).forEach(function (p) { used[p] = 1; }); imgs.data.suggestions.forEach(function (s) { used[s.path] = 1; }); Object.keys(taken).forEach(function (p) { used[p] = 1; });
    var names = Object.keys(used).filter(function (p) { return folderOf(p) === folder; }).map(nameOf);
    if (names.length && names.every(function (n) { return /^\d+\.png$/.test(n); })) return folder + '/' + (names.reduce(function (m, n) { return Math.max(m, parseInt(n, 10) || 0); }, 0) + 1) + '.png';
    var base = String(original || '').replace(/\.[a-z0-9]{2,5}$/i, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 60) || 'image';
    var p = folder + '/' + base + '.png', i = 2;
    while (used[p]) p = folder + '/' + base + '-' + (i++) + '.png';
    return p;
  }
  function startUpload(files, replace, isRecrop) {
    if (!files.length || !imgs.data || !isAdmin()) return;
    if (!window.ScuffedCrop) { toast('The cropper didn\'t load. Reload the app.', 'bad'); return; }
    var folder = replace ? folderOf(replace) : (imgs.folder === SUGG ? folders()[0] : imgs.folder);
    if (replace) files = files.slice(0, 1);
    var taken = {}, paths = files.map(function (f) { var p = replace || newPath(folder, f.name, taken); taken[p] = 1; return p; });
    var cur = replace ? imgs.data.manifest[replace] || {} : null;
    var sawSha = replace ? imgs.data.files[replace].sha : null;
    var longest = cur ? Math.max(cur.w || 512, cur.h || 512) : 512;
    window.ScuffedCrop.open({
      files: files,
      prefs: isRecrop ? { shape: 'free', size: window.ScuffedCrop.SIZES.filter(function (n) { return n <= longest; })[0] || 32, pad: false } : load('scd-images-crop:' + folder, { shape: folder === 'posters' ? 'a4p' : 'original', size: 512, pad: false }),
      startShape: isRecrop ? 'free' : undefined,
      replace: replace ? { path: replace, w: cur.w, h: cur.h } : null,
      targetFor: function (f, i) { return paths[i]; },
      title: isRecrop ? 'Crop ' + nameOf(replace) : replace ? (isDev() ? 'Replace ' : 'Suggest for ') + nameOf(replace) : (isDev() ? 'Crop & upload' : 'Crop & suggest'),
      confirmText: isDev() ? (isRecrop ? 'Save crop' : replace ? 'Replace' : 'Upload') : 'Suggest'
    }).then(function (res) {
      if (!res.items.length) return;
      if (!replace) save('scd-images-crop:' + folder, res.prefs);
      var items = res.items.map(function (r) { var i = files.indexOf(r.file); return { file: r.file, opts: r.opts, path: paths[i], name: nameOf(paths[i]), folder: folder, sha: sawSha, state: 'Converting…' }; });
      imgs.pending = imgs.pending.concat(items);
      if (S.route === 'images') renderImages($('scr-images'));
      var note = '';
      var chain = Promise.resolve();
      items.forEach(function (it) {
        chain = chain.then(function () { return convertPng(it.file, it.opts).then(function (r) { it.blob = r.blob; it.url = URL.createObjectURL(r.blob); it.state = 'Uploading…'; if (S.route === 'images') renderImages($('scr-images')); }); });
      });
      chain.then(function () { return isDev() ? null : promptSheet('Send for approval', 'Note for the developers (optional)', '', 'Send').then(function (n) { if (n === null) throw new Error('cancelled'); note = n; }); })
        .then(function () { return Promise.all(items.map(function (it) { return blobB64(it.blob); })); })
        .then(function (datas) {
          if (isDev()) return worker('/images', { ops: items.map(function (it, i) { return { op: 'put', path: it.path, sha: it.sha, data: datas[i], from: it.file.name }; }) }).then(function (res) {
            (res.changes || []).forEach(function (c) { var it = items.filter(function (x) { return x.path === c.path; })[0]; if (it && c.sha) rememberPic(c.sha, it.blob); });
            watchDeploy(res, 'Images: ' + items.map(function (it) { return it.path; }).join(', '));
            toast('Saved ' + plural(items.length, 'image') + '. Going live now.', 'good');
          });
          return worker('/images/suggest', { note: note, items: items.map(function (it, i) { return { path: it.path, sha: it.sha, data: datas[i], from: it.file.name }; }) }).then(function (res) {
            (res.suggestions || []).forEach(function (s) { var it = items.filter(function (x) { return x.path === s.path; })[0]; if (it) rememberPic(s.blob, it.blob); });
            toast('Sent for approval', 'good');
          });
        })
        .then(function () { haptic(18); imgs.pending = imgs.pending.filter(function (x) { return items.indexOf(x) < 0; }); imgs.data = null; if (S.route === 'images') route(); },
          function (e) { imgs.pending = imgs.pending.filter(function (x) { return items.indexOf(x) < 0; }); if (S.route === 'images') renderImages($('scr-images')); if (errText(e) !== 'cancelled') toast(errText(e), 'bad'); });
    });
  }
  function blobB64(b) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).replace(/^data:[^,]*,/, '')); }; r.onerror = function () { rej(r.error); }; r.readAsDataURL(b); }); }
  // PNG conversion: the same plan as the website (scuffed_dev/images.js plan(): crop/ratio/size/pad, longest side
  // <= 512), on a canvas. Kept in step with that file; the Worker checks the size again either way.
  function planPng(sw, sh, o) {
    o = o || {};
    var N = Math.max(1, Math.min(512, o.size || 512)), r = o.ratio, c = o.crop;
    if (o.pad && r) {
      var W = r >= 1 ? N : Math.max(1, Math.round(N * r)), H = r >= 1 ? Math.max(1, Math.round(N / r)) : N;
      var s = Math.min(W / sw, H / sh), dw = Math.max(1, Math.round(sw * s)), dh = Math.max(1, Math.round(sh * s));
      return { w: W, h: H, sx: 0, sy: 0, sw: sw, sh: sh, dx: Math.round((W - dw) / 2), dy: Math.round((H - dh) / 2), dw: dw, dh: dh };
    }
    if (!c && r) { if (sw / sh > r) { var cw0 = sh * r; c = { x: (sw - cw0) / 2, y: 0, w: cw0, h: sh }; } else { var ch0 = sw / r; c = { x: 0, y: (sh - ch0) / 2, w: sw, h: ch0 }; } }
    if (!c) c = { x: 0, y: 0, w: sw, h: sh };
    var x = Math.max(0, Math.min(c.x, sw - 1)), y = Math.max(0, Math.min(c.y, sh - 1));
    var cw = Math.max(1, Math.min(c.w, sw - x)), ch = Math.max(1, Math.min(c.h, sh - y));
    var k = N / Math.max(cw, ch), w = Math.max(1, Math.round(cw * k)), hh = Math.max(1, Math.round(ch * k));
    return { w: w, h: hh, sx: x, sy: y, sw: cw, sh: ch, dx: 0, dy: 0, dw: w, dh: hh };
  }
  function convertPng(file, opts) {
    return (window.createImageBitmap ? createImageBitmap(file) : Promise.reject()).catch(function () {
      return new Promise(function (res, rej) { var u = URL.createObjectURL(file), im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { rej(new Error('This phone can\'t open that kind of file.')); }; im.src = u; });
    }).then(function (src) {
      var sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight, p = planPng(sw, sh, opts);
      var cur = src, cx = p.sx, cy = p.sy, cw = p.sw, ch = p.sh;
      while (cw > p.dw * 2 && ch > p.dh * 2) {   // step down for clean downscales
        var nw = Math.round(cw / 2), nh = Math.round(ch / 2), t = document.createElement('canvas'); t.width = nw; t.height = nh;
        var tg = t.getContext('2d'); tg.imageSmoothingQuality = 'high'; tg.drawImage(cur, cx, cy, cw, ch, 0, 0, nw, nh);
        cur = t; cx = 0; cy = 0; cw = nw; ch = nh;
      }
      var out = document.createElement('canvas'); out.width = p.w; out.height = p.h;
      var g = out.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cur, cx, cy, cw, ch, p.dx, p.dy, p.dw, p.dh);
      return new Promise(function (res, rej) { out.toBlob(function (b) { if (b && b.type === 'image/png') res({ blob: b, w: p.w, h: p.h }); else rej(new Error('Couldn\'t make a PNG on this phone.')); }, 'image/png'); });
    });
  }

  /* ======================================================================= Announcements (same file format as /announcements/) */

  var NOTIFIER = '[notifier]';
  var ann = { world: 'scuffed', data: null, stamps: {} };
  function nowUtc() { return new Date().toISOString().slice(0, 19) + 'Z'; }
  function splitAnn(text) {
    var board = [], notes = []; ann.stamps = {};
    String(text || '').replace(/\r/g, '').split('\n').forEach(function (line) {
      if (line.trim().toLowerCase().indexOf(NOTIFIER) === 0) {
        var rest = line.trim().slice(NOTIFIER.length).trim(), m = /^@(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\s+([\s\S]*)$/.exec(rest);
        var t = m ? m[2].trim() : rest; if (t) { notes.push(t); if (m) ann.stamps[t] = m[1]; }
      } else board.push(line);
    });
    while (board.length && !board[board.length - 1].trim()) board.pop();
    return { board: board.join('\n'), notes: notes };
  }
  function composeAnn(board, notes) {
    var b = board.replace(/\r/g, '').split('\n').filter(function (l) { return l.trim().toLowerCase().indexOf(NOTIFIER) !== 0; }).join('\n').replace(/\s+$/, '');
    var lines = b ? [b] : [], now = nowUtc();
    if (notes.length) { if (b) lines.push(''); notes.forEach(function (n) { lines.push(NOTIFIER + ' @' + (ann.stamps[n] || now) + ' ' + n); }); }
    return lines.length ? lines.join('\n') + '\n' : '';
  }
  function renderAnnounce(scr, arg) {
    clear(scr);
    if (arg === 'scuffed' || arg === 'straya') { if (ann.world !== arg) ann.data = null; ann.world = arg; }
    scr.appendChild(bigHeader('Announcements', 'The spawn board text and lobby pop-ups. Saving notifies the team.'));
    var seg = h('div', { class: 'chips' });
    [['scuffed', 'Scuffed'], ['straya', 'Straya']].forEach(function (w) { seg.appendChild(h('button', { class: 'chip' + (ann.world === w[0] ? ' on' : ''), type: 'button', text: w[1], onclick: function () { if (ann.world !== w[0]) { ann.world = w[0]; ann.data = null; renderAnnounce(scr); } } })); });
    scr.appendChild(seg);
    keepChips(seg, 'announce');
    var box = h('div'); scr.appendChild(box);
    if (!ann.data) {
      box.appendChild(skeleton(2, 160));
      worker('/announcements?world=' + ann.world).then(function (d) { ann.data = d; ann.parts = splitAnn(d.text); if (S.route === 'announce') renderAnnounce(scr); }, function (e) { clear(box).appendChild(emptyState('!', 'Couldn\'t load the announcements', errText(e))); });
      return;
    }
    var parts = ann.parts;
    var ta = h('textarea', { class: 'textarea', style: 'min-height:220px', 'aria-label': 'Board text', maxlength: '8000' });
    ta.value = parts.board;
    var notes = parts.notes.slice();
    var nl = h('div', { class: 'list', style: 'gap:8px' });
    function drawNotes() {
      clear(nl);
      notes.forEach(function (n, i) {
        nl.appendChild(h('div', { class: 'noteline' }, h('span', { text: '🔔 ' + n }), ann.stamps[n] ? h('time', { text: ago(ann.stamps[n]) }) : h('time', { text: 'new' }),
          h('button', { class: 'icon-btn', type: 'button', html: ic('x'), 'aria-label': 'Remove', style: 'width:36px;height:36px', onclick: function () { notes.splice(i, 1); drawNotes(); } })));
      });
      if (!notes.length) nl.appendChild(h('p', { style: 'margin:0;color:var(--ink3);font-size:.84rem', text: 'No lobby pop-ups. Add one below: it pops up for everyone in the lobby once.' }));
    }
    drawNotes();
    var newNote = h('input', { class: 'input grow', placeholder: 'New pop-up, e.g. Karaoke in 10!', maxlength: '300' });
    var addNote = function () { var v = newNote.value.trim(); if (!v) return; notes.push(v); newNote.value = ''; drawNotes(); haptic(6); };
    newNote.addEventListener('keydown', function (e) { if (e.key === 'Enter') addNote(); });
    box.appendChild(h('div', { class: 'section', text: 'Spawn board' }));
    box.appendChild(ta);
    box.appendChild(h('div', { class: 'section', text: 'Lobby pop-ups' }));
    box.appendChild(nl);
    box.appendChild(h('div', { class: 'row', style: 'margin-top:10px' }, newNote, h('button', { class: 'btn', type: 'button', html: ic('plus'), 'aria-label': 'Add pop-up', style: 'flex:none;width:52px;padding:0', onclick: addNote })));
    setFab('Save', function () {
      var text = composeAnn(ta.value, notes);
      if (text === ann.data.text) { toast('Nothing changed.'); return; }
      confirmSheet('Save the ' + (ann.world === 'scuffed' ? 'Scuffed' : 'Straya') + ' announcements?', 'Everyone with notifications on gets this as a notification, and the world shows it within about 15 minutes.', 'Save').then(function (ok) {
        if (!ok) return;
        worker('/announcements', { world: ann.world, text: text, sha: ann.data.sha }).then(function (res) {
          watchDeploy(res, (ann.world === 'scuffed' ? 'Scuffed' : 'Straya') + ' announcements');
          toast(res.commit ? 'Saved. Notifying the team.' : 'It already matched.', 'good'); haptic(18);
          ann.data = null; renderAnnounce(scr);
        }, function (e) { toast(errText(e), 'bad'); if (e.status === 409) { ann.data = null; renderAnnounce(scr); } });
      });
    }, 'check');
  }

  /* ======================================================================= More / Deploys / Permissions / Settings */

  function renderMore(scr) {
    clear(scr);
    scr.appendChild(bigHeader('More'));
    var D = window.ScuffedDeploy;
    var deps = D ? D.list() : [];
    var status = D ? D.status() : {};
    var active = D ? D.siteEntries().filter(deployActive).length : 0;
    var bad = deps.filter(function (e) { return /failed|stalled/.test(e.state); }).length;
    var rows = [
      ['rocket', 'Deploys', status.error ? status.error.title : active ? active + (active === 1 ? ' active build' : ' active builds') : bad ? bad + ' need attention' : 'GitHub Pages build status', function () { go('deploys'); }],
      isAdmin() ? ['shield', 'Permissions', 'Who holds which role in the world', function () { go('perms'); }] : null,
      ['gear', 'Settings', 'Notifications, appearance, account', function () { go('settings'); }],
      ['globe', 'Open the website', 'kanaris-beans.com/scuffed_dev', function () { window.open(SITE + '/scuffed_dev/', '_blank', 'noopener'); }],
      ['download', 'App updates', 'Get the newest APK from GitHub Releases', function () { window.open(RELEASES, '_blank', 'noopener'); }]
    ].filter(Boolean);
    var panel = h('div', { class: 'panel' });
    rows.forEach(function (r) { panel.appendChild(h('button', { class: 'setting link', type: 'button', onclick: function () { haptic(5); r[3](); } }, h('span', { class: 'ico', html: ic(r[0]) }), h('span', { class: 'txt' }, h('b', { text: r[1] }), h('small', { text: r[2] })))); });
    scr.appendChild(panel);
    scr.appendChild(h('p', { style: 'margin:18px 4px;color:var(--ink3);font-family:var(--mono);font-size:.7rem', text: 'scuffed_dev ' + VERSION + ' · ' + (LEVELS[lvl()] || 'Staff') + ' · ' + deviceLabel() }));
  }

  function deployActive(entry) {
    return entry.state === 'waiting' || entry.state === 'building' || entry.state === 'checking';
  }

  function renderSiteDeploys(scr, D) {
    var status = D ? D.status() : {};
    if (status.error) {
      var warning = emptyState('!', status.error.title, status.error.detail + (status.data ? ' Showing the last known status.' : ''));
      warning.setAttribute('role', 'status');
      scr.appendChild(warning);
    }
    if (!status.data) {
      if (!status.error) scr.appendChild(skeleton(2, 72));
      return;
    }

    var entries = D.siteEntries();
    var active = entries.filter(deployActive);
    var recent = entries.filter(function (entry) { return !deployActive(entry); });
    if (status.data.live) {
      var headline = status.error ? 'Last verified revision ' : 'Public site serves ';
      scr.appendChild(h('p', { class: 'section', text: headline + status.data.live.slice(0, 7) }));
    }
    if (active.length) {
      scr.appendChild(h('h2', { class: 'section', text: status.error ? 'Last known active builds' : 'Active builds (' + active.length + ')' }));
      scr.appendChild(h('div', { class: 'list' }, active.map(function (entry) { return siteDeployCard(entry, !!status.error); })));
    } else if (!status.error) {
      scr.appendChild(emptyState('🚀', 'No active builds', 'New builds will appear here automatically.'));
    }
    if (recent.length) {
      scr.appendChild(h('h2', { class: 'section', text: 'Recent builds' }));
      scr.appendChild(h('div', { class: 'list' }, recent.map(function (entry) { return siteDeployCard(entry, !!status.error); })));
    }
  }

  function siteDeployCard(entry, stale) {
    var stages = entry.stage == null ? null : h('div', { class: 'deploy-stages' },
      ['Build', 'Publish', 'Verify'].map(function (name, i) {
        var done = i < entry.stage;
        var current = i === entry.stage;
        return h('span', {
          class: done ? 'done' : current && !stale ? 'current' : null,
          'aria-current': current && !stale ? 'step' : null,
          text: name
        });
      }));
    return h('div', { class: 'dep s-' + entry.state },
      h('div', { class: 'row deploy-heading' },
        h('b', { text: entry.label }),
        h('span', { text: entry.title })),
      stages,
      entry.detail ? h('p', { class: 'deploy-detail', text: entry.detail }) : null,
      h('div', { class: 'row wrap deploy-meta' },
        h('span', { text: entry.commit.slice(0, 7) + (entry.created ? ' · ' + ago(entry.created) : '') }),
        entry.url ? h('a', { href: entry.url, target: '_blank', rel: 'noopener', text: 'View run ↗' }) : null));
  }

  function renderDeploys(scr) {
    clear(scr);
    scr.appendChild(bigHeader('Deploys', 'GitHub Pages builds and saves from this device.'));
    var D = window.ScuffedDeploy;
    renderSiteDeploys(scr, D);
    var list = D ? D.list().slice().reverse() : [];
    if (!list.length) return;
    scr.appendChild(h('h2', { class: 'section', text: 'Tracked saves' }));
    var ul = h('div', { class: 'list' });
    list.forEach(function (e) {
      var at = /waiting|building/.test(e.state) ? 1 : e.state === 'checking' ? 2 : /live|superseded/.test(e.state) ? 3 : 1;
      var steps = h('div', { class: 'steps' }); [0, 1, 2].forEach(function (i) { steps.appendChild(h('i', { class: i < at ? 'd' : i === at ? 'o' : '' })); });
      var acts = h('div', { class: 'row wrap', style: 'margin-top:8px' });
      if (e.state === 'save-failed' && D.canRetry(e.id)) acts.appendChild(h('button', { class: 'btn sm primary', type: 'button', text: 'Retry save', onclick: function () { D.retry(e.id); } }));
      if (/failed|stalled/.test(e.state) && e.kind === 'deploy') {
        var left = D.cooldownLeft();
        acts.appendChild(h('button', { class: 'btn sm primary', type: 'button', disabled: left ? true : null, text: left ? 'Re-deploy in ' + Math.ceil(left / 1000) + 's' : 'Re-deploy', onclick: function () { D.redeploy(e.id); } }));
        acts.appendChild(h('button', { class: 'btn sm', type: 'button', text: 'Check again', onclick: function () { D.checkAgain(e.id); } }));
      }
      if (!/waiting|building|checking/.test(e.state)) acts.appendChild(h('button', { class: 'btn sm ghost', type: 'button', text: 'Dismiss', onclick: function () { D.dismiss(e.id); } }));
      ul.appendChild(h('div', { class: 'dep s-' + e.state },
        h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', { text: e.label, style: 'font-size:.92rem' }), h('span', { style: 'color:var(--ink3);font-family:var(--mono);font-size:.66rem', text: ago(e.created) })),
        e.kind === 'deploy' ? steps : null,
        h('p', { style: 'margin:4px 0 0;color:var(--ink2);font-size:.84rem', text: e.detail || '' }),
        e.commit ? h('span', { style: 'font-family:var(--mono);font-size:.66rem;color:var(--ink3)', text: e.commit.slice(0, 7) + (e.page ? ' · ' + e.page : '') }) : null, acts));
    });
    scr.appendChild(ul);
  }

  var perms = { data: null, edits: {} };
  var ROLE_LABELS = { 'devs.txt': 'Dev', 'com lead': 'Com Lead', 'mod.txt': 'Mod', 'testers.txt': 'Tester', 'groupowners.txt': 'Group Owner', 'djs.txt': 'Event DJ', 'premiums.txt': 'Prem' };
  function renderPerms(scr) {
    clear(scr);
    scr.appendChild(bigHeader('Permissions', 'Role lists the world reads. Changes reach the world in 5–10 minutes.'));
    if (!isAdmin()) { scr.appendChild(emptyState('🔒', 'Admins only', 'Ask an admin to change roles.')); return; }
    var box = h('div'); scr.appendChild(box);
    if (!perms.data) {
      box.appendChild(skeleton(3, 120));
      worker('/lists').then(function (d) { perms.data = d; perms.edits = {}; if (S.route === 'perms') renderPerms(scr); }, function (e) { clear(box).appendChild(emptyState('!', 'Couldn\'t load the role lists', errText(e))); });
      return;
    }
    var order = Object.keys(ROLE_LABELS);
    var files = perms.data.files.slice().sort(function (a, b) { var ia = order.indexOf(a.name.toLowerCase()), ib = order.indexOf(b.name.toLowerCase()); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    files.forEach(function (f) {
      var lines = String(f.text || '').replace(/\r/g, '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      var names = lines.filter(function (l) { return l.charAt(0) !== '#' && l.indexOf('//') !== 0; });
      var ed = perms.edits[f.name] = perms.edits[f.name] || { add: [], remove: {} };
      var chipsBox = h('div', { class: 'namechips' });
      function draw() {
        clear(chipsBox);
        names.forEach(function (n) { var rm = !!ed.remove[n.toLowerCase()]; chipsBox.appendChild(h('span', { class: 'namechip' + (rm ? ' removed' : '') }, h('span', { text: n }), h('button', { type: 'button', html: rm ? '↺' : ic('x'), 'aria-label': rm ? 'Keep ' + n : 'Remove ' + n, onclick: function () { if (rm) delete ed.remove[n.toLowerCase()]; else ed.remove[n.toLowerCase()] = 1; draw(); paintSave(); } }))); });
        ed.add.forEach(function (n, i) { chipsBox.appendChild(h('span', { class: 'namechip added' }, h('span', { text: n }), h('button', { type: 'button', html: ic('x'), 'aria-label': 'Undo ' + n, onclick: function () { ed.add.splice(i, 1); draw(); paintSave(); } }))); });
        if (!chipsBox.childNodes.length) chipsBox.appendChild(h('span', { style: 'color:var(--ink3);font-size:.84rem', text: 'Nobody yet' }));
      }
      draw();
      var inp = h('input', { class: 'input grow', placeholder: 'VRChat display name', maxlength: '64', 'aria-label': 'Add to ' + (ROLE_LABELS[f.name.toLowerCase()] || f.name) });
      var addName = function () {
        var v = inp.value.trim(); if (!v) return;
        if (/[,\r\n]/.test(v) || v.charAt(0) === '#' || v.indexOf('//') === 0) { toast('Names can\'t contain commas or start with # or //.', 'bad'); return; }
        if (names.concat(ed.add).some(function (n) { return n.toLowerCase() === v.toLowerCase(); })) { toast('Already on this list.'); return; }
        ed.add.push(v); inp.value = ''; draw(); paintSave(); haptic(6);
      };
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') addName(); });
      box.appendChild(h('div', { class: 'panel', style: 'padding:14px;margin-bottom:12px' },
        h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, h('b', { text: ROLE_LABELS[f.name.toLowerCase()] || f.name.replace(/\.txt$/i, ''), style: 'font-family:var(--mono)' }), h('span', { style: 'color:var(--ink3);font-family:var(--mono);font-size:.66rem', text: f.name + ' · ' + names.length })),
        chipsBox, h('div', { class: 'row', style: 'margin-top:10px' }, inp, h('button', { class: 'btn', type: 'button', html: ic('plus'), 'aria-label': 'Add', style: 'flex:none;width:52px;padding:0', onclick: addName }))));
      f._names = names;
    });
    function changes() {
      var out = {};
      files.forEach(function (f) {
        var ed = perms.edits[f.name];
        if (!ed || (!ed.add.length && !Object.keys(ed.remove).length)) return;
        out[f.name] = { sha: f.sha, names: f._names.filter(function (n) { return !ed.remove[n.toLowerCase()]; }).concat(ed.add) };
      });
      return out;
    }
    function paintSave() {
      var n = Object.keys(changes()).length;
      if (!n) { setFab(null); return; }
      setFab('Save ' + plural(n, 'list'), function () {
        if (!perms.data.canSave) { toast('Saving isn\'t switched on (the server needs its GitHub token).', 'bad'); return; }
        var ch = changes();
        worker('/save', { changes: ch }).then(function (res) {
          watchDeploy(res, 'Permissions: ' + Object.keys(ch).map(function (k) { return ROLE_LABELS[k.toLowerCase()] || k; }).join(', '));
          toast('Saved. The world picks it up in 5–10 minutes.', 'good'); haptic(18);
          perms.data = null; renderPerms(scr);
        }, function (e) { toast(errText(e), 'bad'); if (e.status === 409) { perms.data = null; renderPerms(scr); } });
      }, 'check');
    }
    paintSave();
  }

  function sw(on, onChange, disabled) {
    var b = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!on), disabled: disabled ? true : null });
    b.addEventListener('click', function () { var v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); haptic(6); onChange(v, b); });
    return b;
  }
  function settingRow(iconName, title, sub, control) { return h('div', { class: 'setting' }, iconName ? h('span', { class: 'ico', html: ic(iconName) }) : null, h('span', { class: 'txt' }, h('b', { text: title }), sub ? h('small', { text: sub }) : null), control || null); }
  // a labelled slider whose label shows the value as you drag, applied straight away
  function liveSlider(label, min, max, val, unit, set, top) {
    var out = h('b', { text: val + unit, style: 'color:var(--ink);font-family:var(--mono);font-weight:700' });
    return h('div', { class: 'field', style: top ? 'margin-top:' + top : null }, h('span', { class: 'row', style: 'justify-content:space-between' }, label, out),
      slider(min, max, val, function (v) { out.textContent = v + unit; set(v); saveLook(); applyLook(); }));
  }
  function slider(min, max, val, onInput) { var r = h('input', { class: 'range', type: 'range', min: String(min), max: String(max), value: String(val) }); r.addEventListener('input', function () { onInput(Number(r.value)); }); return r; }

  function renderSettings(scr) {
    clear(scr);
    scr.appendChild(bigHeader('Settings'));
    // account
    var me = S.me, prof = window.GameSocial && window.GameSocial.me && window.GameSocial.me();
    scr.appendChild(h('div', { class: 'section', text: 'Account' }));
    scr.appendChild(h('div', { class: 'panel' }, h('div', { class: 'setting' }, avatarEl({ name: me.name, avatar: prof && prof.avatar }, 44),
      h('span', { class: 'txt' }, h('b', { text: me.name }), h('small', { text: (LEVELS[me.level] || 'Staff') + (S.token ? ' · master login' : '') })),
      S.token ? h('button', { class: 'btn sm', type: 'button', text: 'Log out', onclick: function () { var t = S.token; S.token = null; try { sessionStorage.removeItem(MOD_TOKEN_KEY); } catch (e) { /* fine */ } S.client.rpc('mod_logout', { token: t }).then(boot, boot); } }) : null),
      prof ? h('button', { class: 'setting link', type: 'button', onclick: function () { showSigninQr(); } }, h('span', { class: 'ico', html: ic('phone') }),
        h('span', { class: 'txt' }, h('b', { text: 'Sign in on another device' }), h('small', { text: 'Show a one-time sign-in QR for a second device' }))) : null));

    // notifications
    scr.appendChild(h('div', { class: 'section', text: 'Notifications' }));
    var np = h('div', { class: 'panel' });
    scr.appendChild(np);
    currentSub().then(function (sub) {
      var on = !!sub;
      np.appendChild(settingRow('bell', 'This phone', !push.supported ? (/iPhone|iPad|iPod/.test(navigator.userAgent) ? 'Add scuffed_dev to your Home Screen first, then open it from there' : 'Not supported in this browser: install the app') : Notification.permission === 'denied' ? 'Blocked: allow notifications for scuffed_dev in your phone settings' : on ? 'On · ' + deviceLabel() : 'Off', sw(on, function (v) { (v ? enablePush() : disablePush()).then(function () { renderSettings(scr); }); }, !push.supported)));
      np.appendChild(h('div', { class: 'setting', style: 'padding-bottom:4px' }, h('span', { class: 'txt' }, h('small', { text: on ? 'Choose what this phone gets:' : 'Choose what you want, then turn notifications on above:' }))));
      kindToggles().forEach(function (row) { np.appendChild(row); });
      if (on) np.appendChild(h('div', { class: 'setting' }, h('button', { class: 'btn sm primary', type: 'button', html: ic('send') + 'Send a test', onclick: function () { worker('/push/test', { endpoint: sub.endpoint }).then(function (r) { toast(r.sent ? 'Sent: check your notifications' : 'The test didn\'t go through.', r.sent ? 'good' : 'bad'); }, function (e) { toast(errText(e), 'bad'); }); } })));
    });

    // appearance (/chat style)
    scr.appendChild(h('div', { class: 'section', text: 'Appearance' }));
    var ap = h('div', { class: 'panel', style: 'padding:14px' });
    scr.appendChild(ap);
    var chatLook = load('chat.look', null);
    if (chatLook && typeof chatLook === 'object') {
      ap.appendChild(h('div', { class: 'row', style: 'justify-content:space-between;gap:10px;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--line)' },
        h('span', { style: 'color:var(--ink2);font-size:.86rem', text: 'You have a look saved in /chat on this phone.' }),
        h('button', { class: 'btn sm primary', type: 'button', html: ic('palette') + 'Use my /chat look', style: 'flex:none', onclick: function () {
          importChatLook(chatLook).then(function (note) { saveLook(); applyLook(); renderSettings(scr); toast(note || 'Copied your /chat look', 'good'); haptic(12); });
        } })));
    }
    ap.appendChild(h('div', { class: 'field' }, h('span', { text: 'Background' })));
    var bgs = h('div', { class: 'bgs' });
    if (look.grad && Array.isArray(look.grad.stops)) {
      var cg = h('button', { class: 'bgopt' + (look.bg === 'gradient' ? ' on' : ''), type: 'button', text: 'From /chat', onclick: function () { look.bg = 'gradient'; saveLook(); applyLook(); renderSettings(scr); } });
      cg.style.background = gradCss({ angle: Number(look.grad.angle) || 150, stops: look.grad.stops.filter(isHex).slice(0, 3) });
      bgs.appendChild(cg);
    }
    THEMES.forEach(function (t) {
      var o = h('button', { class: 'bgopt' + (look.bg === t.id ? ' on' : ''), type: 'button', text: t.name, onclick: function () { look.bg = t.id; saveLook(); applyLook(); renderSettings(scr); } });
      o.style.background = t.stops ? gradCss(t) : 'radial-gradient(120% 60% at 50% -10%, rgba(255,31,61,.35), transparent 70%), #0a0608';
      bgs.appendChild(o);
    });
    var solid = h('button', { class: 'bgopt' + (look.bg === 'solid' ? ' on' : ''), type: 'button', text: 'Solid', onclick: function () { var c = h('input', { type: 'color', value: look.solid }); c.addEventListener('input', function () { look.solid = c.value; look.bg = 'solid'; saveLook(); applyLook(); }); c.addEventListener('change', function () { renderSettings(scr); }); c.click(); } });
    solid.style.background = look.solid;
    var cust = h('button', { class: 'bgopt' + (look.bg === 'custom' ? ' on' : ''), type: 'button', text: 'Custom', onclick: function () { customGradientSheet(scr); } });
    cust.style.background = look.custom ? gradCss(customGrad()) : 'conic-gradient(from 210deg at 50% 60%, #ff1f3d, #f59e0b, #10b981, #06b6d4, #7c3aed, #ff1f3d)';
    var photo = h('button', { class: 'bgopt' + (look.bg === 'image' ? ' on' : ''), type: 'button', text: 'Photo', onclick: function () {
      var f = h('input', { type: 'file', accept: 'image/*' });
      f.addEventListener('change', function () { var file = f.files[0]; if (!file) return; shrinkPhoto(file).then(function (url) { look.image = url; look.bg = 'image'; saveLook(); applyLook(); renderSettings(scr); }, function (e) { toast(errText(e), 'bad'); }); });
      f.click();
    } });
    if (look.image) photo.style.background = 'center / cover url("' + look.image + '")'; else photo.style.background = '#1a1015';
    var anim = h('button', { class: 'bgopt' + (look.bg === 'animated' ? ' on' : ''), type: 'button', text: 'Animated', onclick: function () { look.bg = 'animated'; saveLook(); applyLook(); renderSettings(scr); } });
    anim.style.background = 'linear-gradient(135deg,#7331e5,#eb389d,#256dde)';
    bgs.appendChild(solid); bgs.appendChild(cust); bgs.appendChild(photo); bgs.appendChild(anim);
    ap.appendChild(bgs);
    if (look.bg === 'animated') {
      var sc = h('div', { class: 'chips', style: 'margin-top:12px' });
      Object.keys(SCENES).forEach(function (g) { SCENES[g].forEach(function (n, i) { sc.appendChild(h('button', { class: 'chip' + (look.scene === g && look.sceneIndex === i ? ' on' : ''), type: 'button', text: n, onclick: function () { look.scene = g; look.sceneIndex = i; saveLook(); applyLook(); renderSettings(scr); } })); }); });
      ap.appendChild(sc);
      keepChips(sc, 'scenes');
      ap.appendChild(liveSlider('Pixelation', 1, 5, look.pixel || 2, '×', function (v) { look.pixel = v; }, '12px'));
    }
    if (look.bg === 'image' || look.bg === 'animated') {
      ap.appendChild(liveSlider('Dim', 0, 85, look.dim, '%', function (v) { look.dim = v; }, '12px'));
      ap.appendChild(liveSlider('Blur', 0, 20, look.blur, 'px', function (v) { look.blur = v; }));
    }
    ap.appendChild(h('div', { class: 'field', style: 'margin-top:14px' }, h('span', { text: 'Accent' })));
    var sws = h('div', { class: 'swatches' });
    if (Array.isArray(look.accent)) {
      var mine = h('button', { class: 'swatch on', type: 'button', 'aria-label': 'Your /chat accent', title: 'From /chat' });
      mine.style.background = 'linear-gradient(135deg,' + accentPair()[0] + ',' + accentPair()[1] + ')';
      sws.appendChild(mine);
    }
    ACCENTS.forEach(function (a, i) { var s = h('button', { class: 'swatch' + (look.accent === i ? ' on' : ''), type: 'button', 'aria-label': 'Accent ' + (i + 1), onclick: function () { look.accent = i; saveLook(); applyLook(); renderSettings(scr); haptic(6); } }); s.style.background = 'linear-gradient(135deg,' + a[0] + ',' + a[1] + ')'; sws.appendChild(s); });
    ap.appendChild(sws);
    ap.appendChild(liveSlider('Panel opacity', 30, 100, look.panel, '%', function (v) { look.panel = v; }, '14px'));
    ap.appendChild(liveSlider('Glass blur', 0, 30, look.glass, 'px', function (v) { look.glass = v; }));
    ap.appendChild(liveSlider('Text size', 13, 20, look.size, 'px', function (v) { look.size = v; }));
    ap.appendChild(h('button', { class: 'btn sm ghost', type: 'button', text: 'Reset appearance', onclick: function () { look = Object.assign({}, LOOK_DEFAULT); saveLook(); applyLook(); renderSettings(scr); } }));

    scr.appendChild(h('div', { class: 'section', text: 'Feel' }));
    scr.appendChild(h('div', { class: 'panel' },
      settingRow('phone', 'Haptics', 'A small buzz on taps and saves', sw(prefs.haptics !== false, function (v) { prefs.haptics = v; savePrefs(); })),
      settingRow(null, 'Compact layout', 'Tighter spacing, more on screen', sw(!!prefs.compact, function (v) { prefs.compact = v; savePrefs(); applyLook(); })),
      settingRow(null, 'Reduce motion', 'Turn animations off', sw(!!prefs.calm, function (v) { prefs.calm = v; savePrefs(); applyLook(); })),
      h('button', { class: 'setting link', type: 'button', onclick: function () { startTour(null); } }, h('span', { class: 'ico', html: ic('hand') }),
        h('span', { class: 'txt' }, h('b', { text: 'App tour' }), h('small', { text: 'Show the quick tour again' })))));
    scr.appendChild(h('p', { style: 'margin:18px 4px;color:var(--ink3);font-family:var(--mono);font-size:.7rem', text: 'scuffed_dev ' + VERSION }));
  }
  // Settings > Appearance > Custom: build your own gradient from 2-3 colours and an angle. Every change shows
  // straight away behind the sheet; Cancel, or closing the sheet any other way, puts the old background back.
  function customGradientSheet(scr) {
    var before = { bg: look.bg, custom: look.custom }, saved = false;
    var g = customGrad(), draft = { stops: g.stops.slice(), angle: g.angle };
    var preview = h('div', { class: 'grad-preview' }), stopsBox = h('div', { class: 'gstops' });
    var angleOut = h('b', { text: draft.angle + '°', style: 'color:var(--ink);font-family:var(--mono);font-weight:700' });
    var angle = slider(0, 359, draft.angle, function (v) { draft.angle = v; angleOut.textContent = v + '°'; paint(); });
    function paint() {
      preview.style.background = gradCss(draft);
      look.bg = 'custom'; look.custom = { stops: draft.stops.slice(), angle: draft.angle };
      applyLook();
    }
    function drawStops() {
      clear(stopsBox);
      draft.stops.forEach(function (c, i) {
        var inp = h('input', { type: 'color', value: c, 'aria-label': 'Colour ' + (i + 1) }), lab = h('small', { text: c });
        inp.addEventListener('input', function () { draft.stops[i] = inp.value; lab.textContent = inp.value; paint(); });
        stopsBox.appendChild(h('label', { class: 'gstop' }, inp, lab, draft.stops.length > 2
          ? h('button', { class: 'rm', type: 'button', html: ic('x'), 'aria-label': 'Remove colour ' + (i + 1), onclick: function (e) { e.preventDefault(); draft.stops.splice(i, 1); drawStops(); paint(); } }) : null));
      });
      if (draft.stops.length < 3) stopsBox.appendChild(h('button', { class: 'gstop add', type: 'button', html: ic('plus') + 'Add colour', onclick: function () { draft.stops.push(accentPair()[1]); drawStops(); paint(); } }));
    }
    function shuffle() {
      var hue = Math.floor(Math.random() * 360), spread = 30 + Math.floor(Math.random() * 70);
      draft.stops = [hslHex(hue, 70, 7), hslHex((hue + spread) % 360, 75, 28), hslHex((hue + spread * 2) % 360, 85, 55)];
      draft.angle = Math.floor(Math.random() * 360);
      angle.value = String(draft.angle); angleOut.textContent = draft.angle + '°';
      drawStops(); paint(); haptic(8);
    }
    function flip() { draft.stops.reverse(); drawStops(); paint(); haptic(6); }
    drawStops();
    var body = h('div', null, preview,
      h('div', { class: 'field' }, h('span', { text: 'Colours' })), stopsBox,
      h('div', { class: 'field' }, h('span', { class: 'row', style: 'justify-content:space-between' }, 'Angle', angleOut), angle),
      h('div', { class: 'row', style: 'gap:8px' },
        h('button', { class: 'btn sm', type: 'button', html: ic('refresh') + 'Shuffle', onclick: shuffle }),
        h('button', { class: 'btn sm', type: 'button', text: '⇄ Flip colours', onclick: flip })));
    openSheet('Custom gradient', body, [
      h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: function () { closeSheet(); } }),
      h('button', { class: 'btn primary', type: 'button', text: 'Use this', onclick: function () { saved = true; saveLook(); closeSheet(); renderSettings(scr); toast('Background saved', 'good'); haptic(12); } })
    ], function () { if (!saved) { look.bg = before.bg; look.custom = before.custom; applyLook(); } });
    paint();
  }
  function shrinkPhoto(file) {
    return createImageBitmap(file).then(function (b) {
      var k = Math.min(1, 1100 / Math.max(b.width, b.height)), c = document.createElement('canvas');
      c.width = Math.round(b.width * k); c.height = Math.round(b.height * k);
      c.getContext('2d').drawImage(b, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.82);
    });
  }

  /* ======================================================================= small views */

  function skeleton(n, hgt) { var d = h('div', { class: 'list' }); for (var i = 0; i < n; i++) d.appendChild(h('div', { class: 'skel', style: 'height:' + hgt + 'px' })); return d; }
  function emptyState(glyph, title, text) { return h('div', { class: 'empty' }, h('span', { class: 'glyph', text: glyph }), h('b', { text: title }), text ? h('span', { text: text }) : null); }

  /* ======================================================================= sign in */

  function gate(state, text) {
    var scr = clear($('scr-gate'));
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.toggle('on', s.id === 'scr-gate'); });
    $('nav').classList.add('hidden'); setFab(null);
    var box = h('div', { class: 'gate' }, h('img', { class: 'logo', src: '/scuffed_dev/app/icons/icon-192.png', alt: '' }));
    scr.appendChild(box);
    if (state === 'checking') { box.appendChild(h('h1', { text: 'scuffed_dev' })); box.appendChild(h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('p', { text: 'Signing you in…' }))); return; }
    if (state === 'offline') { box.appendChild(h('h1', { text: 'Can\'t connect' })); box.appendChild(h('p', { text: text || 'Check your connection.' })); box.appendChild(h('button', { class: 'btn primary', type: 'button', text: 'Try again', onclick: boot })); return; }
    var prof = window.GameSocial && window.GameSocial.me && window.GameSocial.me();
    var scanBtn = h('button', { class: 'btn primary block', type: 'button', html: ic('scan') + 'Scan sign-in QR', onclick: function () { openScanner(); } });
    var howTo = h('ol', { class: 'gate-steps' },
      h('li', null, 'On your PC, open ', h('b', { text: 'kanaris-beans.com/scuffed_dev' }), '.'),
      h('li', null, 'Under ', h('b', { text: 'Get the app' }), ', tap ', h('b', { text: 'Show sign-in QR' }), '.'),
      h('li', null, 'Scan it here. You\'re signed in with the same account.'));
    if (state === 'create') {
      box.appendChild(h('h1', { text: 'Sign in' }));
      box.appendChild(h('p', { text: 'scuffed_dev uses your kanaris-beans.com account: the same one as the site\'s chat and games.' }));
      box.appendChild(howTo);
      box.appendChild(scanBtn);
      var ed = h('div', { class: 'panel', style: 'padding:14px' });
      var made = false;
      box.appendChild(disclosure('New here? Make a profile', function (body) {
        if (!made) { made = true; body.appendChild(ed); if (window.Games && window.Games.Profile) window.Games.Profile.mount(ed, function (pr) { if (window.GameSocial && window.GameSocial.localProfileChanged) window.GameSocial.localProfileChanged(pr); }); body.appendChild(h('button', { class: 'btn primary block', type: 'button', text: 'Create profile', style: 'margin-top:10px', onclick: createProfile })); }
      }));
    } else {
      // denied: signed in, but this account isn't staff (or not yet)
      box.appendChild(h('h1', { text: 'Staff only' }));
      box.appendChild(h('p', { text: 'scuffed_dev is for Scuffed staff (moderator and up).' + (prof && prof.name ? ' This phone is signed in as ' + prof.name + ', which isn\'t staff.' : '') + ' If your staff account is on your PC, scan its sign-in QR to switch this phone to it.' }));
      box.appendChild(howTo);
      box.appendChild(scanBtn);
    }
    var u = h('input', { class: 'input', autocomplete: 'username', placeholder: 'Username' }), p = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Password' });
    var msg = h('p', { style: 'color:var(--bad);min-height:1.2em;font-size:.86rem;margin:6px 0' });
    box.appendChild(disclosure('Master login', function (body) {
      if (body.childNodes.length) return;
      add(body, [h('div', { class: 'field' }, u), h('div', { class: 'field' }, p), msg,
        h('button', { class: 'btn block', type: 'button', text: 'Log in', onclick: function () {
          msg.textContent = 'Checking…';
          S.client.rpc('mod_master_login', { username: u.value, password: p.value }).then(function (r) {
            p.value = '';
            if (r.error) { msg.textContent = r.error.message; return; }
            S.token = r.data; try { sessionStorage.setItem(MOD_TOKEN_KEY, S.token); } catch (e) { /* fine */ } boot();
          });
        } })]);
    }));
    box.appendChild(h('button', { class: 'btn ghost', type: 'button', text: 'Check again', onclick: boot }));
    if (pendingSignin) { var code = pendingSignin; pendingSignin = null; setTimeout(function () { confirmSignin(code); }, 250); }
  }
  // a tap-to-open section (the body is filled the first time it opens)
  function disclosure(title, fill) {
    var body = h('div', { class: 'disc-body hidden' });
    var btn = h('button', { class: 'disc-head', type: 'button', 'aria-expanded': 'false' }, h('span', { text: title }), h('i', { text: '›' }));
    btn.addEventListener('click', function () { var open = body.classList.contains('hidden'); if (open) fill(body); body.classList.toggle('hidden', !open); btn.setAttribute('aria-expanded', String(open)); haptic(5); });
    return h('div', { class: 'disc' }, btn, body);
  }

  /* ======================================================================= QR sign-in (device links: supabase/migrations/2026-10-11-device-links.sql)
     A signed-in device makes a one-time code (link_code_create, 10 minutes) and shows it as a QR of
     https://kanaris-beans.com/scuffed_dev/app/#link/CODE. Android App Links open the app from the phone camera.
     The app confirms the account link before redeeming the code (link_code_redeem). */

  var pendingSignin = null, signinBusy = false;
  var signin = window.ScuffedSignin;
  function takeSigninFromUrl() {
    var current = new URL(location.href);
    var code = signin.read(current);
    var hasLink = current.hash.indexOf('#link/') === 0;
    if (hasLink || current.searchParams.has('signin')) {
      current.searchParams.delete('signin');
      current.searchParams.delete('web');
      if (hasLink) current.hash = '';
      history.replaceState(history.state, '', current.pathname + current.search + current.hash);
    }
    if (code) pendingSignin = code;
    return code;
  }
  function confirmSignin(code) {
    var prof = window.GameSocial && window.GameSocial.me && window.GameSocial.me();
    var mine = S.me ? 'You\'re signed in as ' + S.me.name + '. ' : prof && prof.name ? 'This phone has its own profile (' + prof.name + '). ' : '';
    var body = h('div', null, h('p', { style: 'margin:0 0 10px;color:var(--ink2)', text: mine + 'Sign this phone in with the account that made code ' + code.slice(0, 4) + '-' + code.slice(4) + '?' }),
      h('p', { style: 'margin:0;color:var(--ink3);font-size:.82rem', text: 'Only scan codes you made yourself: this phone will act as that account.' }));
    var foot = [h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: function () { closeSheet(); } })];
    if (prof && !S.me) {
      foot.push(h('button', { class: 'btn', type: 'button', text: 'Leave it behind', onclick: function () { closeSheet(); redeemSignin(code, false); } }));
      foot.push(h('button', { class: 'btn primary', type: 'button', text: 'Merge & sign in', onclick: function () { closeSheet(); redeemSignin(code, true); } }));
      body.appendChild(h('p', { style: 'margin:10px 0 0;color:var(--ink3);font-size:.82rem', text: 'Merge brings this phone\'s XP, achievements and friends along; leave it behind keeps them out.' }));
    } else foot.push(h('button', { class: 'btn primary', type: 'button', text: 'Sign in', onclick: function () { closeSheet(); redeemSignin(code, true); } }));
    openSheet('Sign in with this code?', body, foot);
  }
  function redeemSignin(code, merge) {
    if (signinBusy) return;
    var D = window.GameSocial && window.GameSocial.device;
    if (!D || !D.available()) { toast('Signing in with a code needs the site\'s player accounts.', 'bad'); return; }
    signinBusy = true;
    toast('Signing in…');
    D.redeem(code, deviceLabel().slice(0, 40), merge).then(function () {
      toast('Signed in. Loading your account…', 'good'); haptic(20);
      setTimeout(function () { location.replace('/scuffed_dev/app/' + location.hash); }, 900);
    }, function (e) {
      signinBusy = false;
      var m = errText(e);
      if (/already part of that account/i.test(m)) toast('This phone is already signed in with that account.', 'good');
      else toast(/function|schema|does not exist/i.test(m) ? 'Signing in with a code isn\'t set up on the site yet.' : m, 'bad');
    });
  }

  // camera scanner: the browser's own QR reader (Chrome on Android) or jsQR (iPhone Safari has no reader)
  var jsqrLoad = null;
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Couldn\'t load ' + src)); }; document.head.appendChild(s); }); }
  function qrReader() {
    var native = 'BarcodeDetector' in window ? Promise.resolve(window.BarcodeDetector.getSupportedFormats ? window.BarcodeDetector.getSupportedFormats() : ['qr_code']).catch(function () { return []; }) : Promise.resolve([]);
    return native.then(function (formats) {
      if (formats.indexOf('qr_code') >= 0) { var det = new window.BarcodeDetector({ formats: ['qr_code'] }); return function (video) { return det.detect(video).then(function (r) { return r && r[0] ? r[0].rawValue : null; }); }; }
      jsqrLoad = jsqrLoad || loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
      return jsqrLoad.then(function () {
        var c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
        return function (video) {
          var w = video.videoWidth, hh = video.videoHeight; if (!w || !hh) return Promise.resolve(null);
          var k = Math.min(1, 720 / Math.max(w, hh)); c.width = Math.round(w * k); c.height = Math.round(hh * k);
          g.drawImage(video, 0, 0, c.width, c.height);
          var r = window.jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'dontInvert' });
          return Promise.resolve(r ? r.data : null);
        };
      });
    });
  }
  function openScanner() {
    var video = h('video', { playsinline: true, muted: true, autoplay: true });
    video.muted = true; video.setAttribute('playsinline', '');
    var status = h('p', { class: 'scan-status', text: 'Starting the camera…' });
    var stream = null, stopped = false;
    var stop = function () { stopped = true; if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; };
    var code = h('input', { class: 'input grow', placeholder: 'ABCD-EFGH', maxlength: '9', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Sign-in code', style: 'font-family:var(--mono);letter-spacing:.12em;text-transform:uppercase' });
    var typed = function () { var c = signin.parse(code.value); if (!c) { toast('Codes are 8 letters and numbers, like ABCD-EFGH.', 'bad'); return; } stop(); closeSheet(); confirmSignin(c); };
    code.addEventListener('keydown', function (e) { if (e.key === 'Enter') typed(); });
    openSheet('Scan sign-in QR', [h('div', { class: 'scan' }, video, h('div', { class: 'scan-frame' }, h('i'), h('i'), h('i'), h('i'))), status,
      h('div', { class: 'field', style: 'margin-top:12px' }, h('span', { text: 'Or type the code under the QR' }), h('div', { class: 'row' }, code, h('button', { class: 'btn primary', type: 'button', text: 'Go', style: 'flex:none', onclick: typed })))],
      null, stop);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { status.textContent = 'This browser can\'t use the camera here. Type the code instead.'; return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false }).then(function (s) {
      if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s; video.srcObject = s; video.play().catch(function () {});
      status.textContent = 'Point it at the QR on your PC.';
      return qrReader().then(function (read) {
        (function tick() {
          if (stopped) return;
          read(video).then(function (text) {
            if (stopped) return;
            var c = text && signin.parse(text);
            if (c) { haptic(25); stop(); closeSheet(); confirmSignin(c); return; }
            if (text) status.textContent = 'That QR isn\'t a scuffed_dev sign-in code.';
            setTimeout(tick, 180);
          }, function () { setTimeout(tick, 400); });
        })();
      }, function () { status.textContent = 'Couldn\'t start the QR reader. Type the code instead.'; });
    }, function (e) {
      status.textContent = e && e.name === 'NotAllowedError' ? 'Camera blocked. Allow camera access for scuffed_dev, or type the code instead.' : 'Couldn\'t open the camera. Type the code instead.';
    });
  }

  // show a sign-in QR from this phone, for another device
  var qrLibLoad = null;
  function showSigninQr() {
    var D = window.GameSocial && window.GameSocial.device;
    var box = h('div', { class: 'qr-box' }, h('p', { class: 'scan-status', text: 'Making a code…' }));
    openSheet('Sign in on another device', box, null);
    if (!D || !D.available()) { clear(box).appendChild(h('p', { class: 'scan-status', text: 'This needs the site\'s player accounts.' })); return; }
    D.create({}, deviceLabel().slice(0, 40)).then(function (code) {
      clear(box);
      var qr = h('div', { class: 'qr' });
      var left = h('p', { class: 'scan-status' });
      add(box, [qr, h('div', { class: 'qr-code', text: code.slice(0, 4) + '-' + code.slice(4) }), left,
        h('p', { style: 'margin:6px 0 0;color:var(--ink3);font-size:.8rem;text-align:center', text: 'Scan with the app or your Android camera. Works once.' })]);
      var ends = Date.now() + 600000;
      (function tick() { var s = Math.max(0, Math.round((ends - Date.now()) / 1000)); left.textContent = s ? 'Expires in ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : 'Expired. Close this and make a new one.'; if (s && left.isConnected) setTimeout(tick, 1000); })();
      qrLibLoad = qrLibLoad || loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
      return qrLibLoad.then(function () { new window.QRCode(qr, { text: signin.url(code), width: 220, height: 220, colorDark: '#0a0608', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M }); });
    }).catch(function (e) { clear(box).appendChild(h('p', { class: 'scan-status', text: errText(e) })); });
  }
  function createProfile() {
    var pr = window.Games.Profile.get();
    S.client.rpc('tetris_me').then(function (r) { return r && !r.error && r.data ? r.data : null; }, function () { return null; }).then(function (id) {
      return id || S.client.auth.getSession().then(function (r) { return r.data && r.data.session ? r.data.session.user.id : null; });
    }).then(function (uid) {
      if (!uid) throw new Error('No sign-in yet. Reopen the app and try again.');
      return S.client.from('tetris_profiles').insert({ id: uid, name: (pr.name || 'Player').slice(0, 16), avatar: pr.avatar || null, equipped: { banner: 'dusk' } });
    }).then(function (r) { if (r && r.error && !/duplicate/i.test(r.error.message || '')) throw r.error; toast('Profile created', 'good'); setTimeout(boot, 1200); }, function (e) { toast(errText(e), 'bad'); });
  }

  function waitClient(ms) {
    return new Promise(function (res) { var t0 = Date.now(); (function poll() { var c = window.GameSocial && window.GameSocial.client && window.GameSocial.client(); if (c) return res(c); if (Date.now() - t0 > ms) return res(null); setTimeout(poll, 120); })(); });
  }
  function boot() {
    gate('checking');
    try { S.token = sessionStorage.getItem(MOD_TOKEN_KEY); } catch (e) { S.token = null; }
    if (!window.GameSocial || !window.GameSocial.enabled) return gate('offline', 'Player accounts are switched off on this copy of the site.');
    waitClient(15000).then(function (c) {
      if (!c) return gate('offline', 'Couldn\'t reach the player account service.');
      S.client = c;
      return new Promise(function (res) { var done = false; window.GameSocial.ready(function () { if (!done) { done = true; res(); } }); setTimeout(function () { if (!done) { done = true; res(); } }, 2500); })
        .then(function () { return c.rpc('mod_me', { token: S.token }); })
        .then(function (r) {
          if (r.error) throw r.error;
          var level = (r.data && r.data.level) || 0;
          var prof = window.GameSocial.me && window.GameSocial.me();
          if (level < 2) { if (S.token) { S.token = null; try { sessionStorage.removeItem(MOD_TOKEN_KEY); } catch (e) { /* fine */ } } return gate(prof ? 'denied' : 'create'); }
          var uid = window.GameSocial.uid && window.GameSocial.uid();
          S.me = { level: level, name: (prof && prof.name) || r.data.actor || 'Staff', id: prof ? uid : null };
          var mb = clear($('meBtn'));
          if (prof && prof.avatar && /^data:image\//.test(prof.avatar)) mb.appendChild(h('img', { src: prof.avatar, alt: '' })); else mb.textContent = S.me.name.charAt(0).toUpperCase();
          $('nav').classList.remove('hidden');
          route();
          if (pendingSignin) { var sc = pendingSignin; pendingSignin = null; setTimeout(function () { confirmSignin(sc); }, 300); }
          else setTimeout(function () { maybeTour(maybeWelcome); }, 700);
          // background: history badge, board badge, keep this phone's notification level/prefs current
          loadHistory().then(paintBadges, function () {});
          if (!board.data) loadBoard().catch(function () {});
          currentSub().then(function (s) { if (s) registerSub(s).catch(function () {}); });
        });
    }).catch(function (e) { gate('offline', 'Couldn\'t check your access: ' + errText(e)); });
  }

  /* ======================================================================= wiring */

  document.addEventListener('DOMContentLoaded', function () {
    takeSigninFromUrl();
    applyLook();
    // Android Back: close the sheet first, then step back through screens
    window.addEventListener('popstate', function () { if (backPending) backLanded(); else if (sheetOpen) closeSheet(true); });
    window.addEventListener('hashchange', function () {
      if (takeSigninFromUrl()) boot(); else route();
    });
    $('scrim').addEventListener('click', function () { closeSheet(); });
    $('sheetClose').addEventListener('click', function () { closeSheet(); });
    navSwipe();
    document.querySelectorAll('.nav button').forEach(function (b) { b.addEventListener('click', function () { haptic(5); var g = b.getAttribute('data-go'); if (S.route === g) { $('main').scrollTop = 0; refreshCurrent(); } else go(g); }); });
    $('barBell').addEventListener('click', function () { go('history'); });
    $('meBtn').addEventListener('click', function () { if (S.me) go('settings'); });
    $('barAction').addEventListener('click', function () { haptic(6); dropCaches(); refreshCurrent(); });
    $('filePick').addEventListener('change', function () { var files = Array.prototype.slice.call($('filePick').files || []); var t = pickTarget; pickTarget = null; startUpload(files, t, false); });
    // large title collapses into the bar
    $('main').addEventListener('scroll', function () { $('app').classList.toggle('scrolled', $('main').scrollTop > 46); }, { passive: true });
    // pull to refresh
    (function () {
      var y0 = null, dy = 0, ptr = $('ptr'), main = $('main');
      main.addEventListener('touchstart', function (e) { if (main.scrollTop <= 0 && !sheetOpen) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
      main.addEventListener('touchmove', function (e) { if (y0 === null) return; dy = e.touches[0].clientY - y0; if (dy <= 0) { ptr.style.opacity = 0; return; } var d = Math.min(90, dy * 0.5); ptr.style.transform = 'translateY(' + (d - 50) + 'px) rotate(' + d * 4 + 'deg)'; ptr.style.opacity = String(Math.min(1, d / 60)); }, { passive: true });
      main.addEventListener('touchend', function () {
        if (y0 === null) return; y0 = null;
        if (dy * 0.5 > 64) { ptr.classList.add('spin'); haptic(12); dropCaches(); refreshCurrent(); setTimeout(function () { ptr.classList.remove('spin'); ptr.style.opacity = 0; ptr.style.transform = ''; }, 700); }
        else { ptr.style.opacity = 0; ptr.style.transform = ''; }
      });
    })();
    if (window.ScuffedDeploy) window.ScuffedDeploy.onChange(function (list, status) {
      var bad = list.some(function (e) { return /failed|stalled/.test(e.state); });
      var active = window.ScuffedDeploy.siteEntries().filter(deployActive).length;
      $('navMore').textContent = status.error || bad ? '!' : active ? String(active) : '';
      if (S.route === 'deploys') renderDeploys($('scr-deploys'));
      if (S.route === 'more') renderMore($('scr-more'));
    });
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/scuffed_dev/app/sw.js', { scope: '/scuffed_dev/app/' }).catch(function () {});
      navigator.serviceWorker.addEventListener('message', function (e) {
        var m = e.data || {};
        if (m.type === 'push') { hist.items = null; loadHistory().then(function () { paintBadges(); if (S.route === 'history') renderHistory($('scr-history')); }, function () {}); }
        if (m.type === 'open' && m.url) { var r = /#([a-z]+)(?:\/(.*))?$/.exec(m.url); if (r) go(r[1], r[2] ? decodeURIComponent(r[2]) : ''); }
      });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden || !S.me) return;
      loadHistory().then(paintBadges, function () {});
    });
    boot();
  });
  function dropCaches() { if (S.route === 'board') board.data = null; if (S.route === 'images') imgs.data = null; if (S.route === 'history') hist.items = null; if (S.route === 'announce') ann.data = null; if (S.route === 'perms') perms.data = null; }
})();
