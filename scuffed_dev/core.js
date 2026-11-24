// scuffed_dev/core.js: shared by the scuffed_dev pages (the hub at /scuffed_dev/ and the board at
// /scuffed_dev/board/). Signing in, the staff-level gate, talking to the devboard_* database functions,
// people and pictures, and the small helpers both pages use. Exposed as window.ScuffedDev.
//
// Signing in is the same player account as the games, chat and /scuffed_perms (games-social.js runs on these
// pages too). Levels come from the moderation panel: helper 1, moderator 2, admin 3, developer 4, master login 5.
// The pages only hide things. The database functions (supabase/migrations/2026-11-24-scuffed-dev-board.sql)
// check the caller's level on every call.
(function () {
  'use strict';

  var MOD_TOKEN_KEY = 'balcade-mod-token';   // same key /moderation.html and /scuffed_perms use (this tab only)

  var STATUSES = [
    { id: 'unclaimed', label: 'Unclaimed', sym: '○' },
    { id: 'claimed', label: 'Claimed', sym: '◔' },
    { id: 'in_progress', label: 'In progress', sym: '◑' },
    { id: 'testing', label: 'Testing', sym: '◕' },
    { id: 'complete', label: 'Complete', sym: '●' }
  ];
  var STATUS_BY = {};
  STATUSES.forEach(function (s, i) { s.rank = i; STATUS_BY[s.id] = s; });
  var PRIORITY = { high: { label: 'High', rank: 0 }, normal: { label: 'Normal', rank: 1 }, low: { label: 'Low', rank: 2 } };
  var LEVEL_NAMES = { 1: 'Helper', 2: 'Moderator', 3: 'Admin', 4: 'Developer', 5: 'Master' };
  var ROLE_NAMES = { helper: 'Helper', moderator: 'Moderator', admin: 'Admin', dev: 'Developer' };

  var client = null;
  var modToken = null;
  var me = null;          // { level, id, name } once let in
  var people = {};
  var opts = {};

  /* ---------- small helpers ---------- */

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function show(id, on) { var e = typeof id === 'string' ? $(id) : id; if (e) e.classList.toggle('hidden', !on); }
  function on(id, ev, fn) { var e = $(id); if (e) e.addEventListener(ev, fn); }
  function time(v) { var t = Date.parse(v); return isNaN(t) ? 0 : t; }
  function status(id, text, kind) { var s = $(id); if (!s) return; s.textContent = text || ''; s.className = 'perms-status' + (kind ? ' is-' + kind : ''); }
  function errText(e) { return (e && (e.message || e.details)) || String(e || 'Something went wrong'); }
  function readModToken() { try { return sessionStorage.getItem(MOD_TOKEN_KEY); } catch (e) { return null; } }
  function storeModToken(t) { try { if (t) sessionStorage.setItem(MOD_TOKEN_KEY, t); else sessionStorage.removeItem(MOD_TOKEN_KEY); } catch (e) { /* tab-only anyway */ } }

  function ago(v) {
    var t = time(v);
    if (!t) return '';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.round(s / 86400) + 'd ago';
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fullDate(v) {
    var t = time(v);
    return t ? new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  }

  function statusBadge(st) {
    var s = STATUS_BY[st];
    var b = el('span', 'db-status st-' + st);
    b.appendChild(el('i', null, s.sym));
    b.appendChild(document.createTextNode(s.label));
    return b;
  }

  /* ---------- people ---------- */

  function person(uid, fallback) {
    var p = uid && people[uid];
    return { id: uid || null, name: (p && p.name) || fallback || 'Someone', avatar: (p && p.avatar) || null, role: (p && p.role) || null };
  }

  // Round picture: the games' own avatar element (it only accepts data:image pictures), or the first letter.
  function avatar(p, size) {
    if (window.Games && window.Games.Profile) return window.Games.Profile.avatar({ name: p.name, avatar: p.avatar }, size);
    var a = el('span', 'avatar', String(p.name || '?').charAt(0).toUpperCase());
    a.style.width = a.style.height = size + 'px';
    return a;
  }

  function roleWord(p, fallbackName) {
    if (p.role) return ROLE_NAMES[p.role] || p.role;
    if (/\(master\)$/.test(fallbackName || p.name || '')) return 'Master login';
    return 'Player';
  }

  /* ---------- the database ---------- */

  function rpc(name, args) {
    args = Object.assign({ token: modToken || null }, args || {});
    return client.rpc(name, args).then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }

  // Everything the board knows: { me, items, people, devs }. Also keeps people and "me" up to date here.
  function list() {
    return rpc('devboard_list').then(function (data) {
      data = data || {};
      data.items = (data.items || []).filter(function (it) { return STATUS_BY[it.status] && PRIORITY[it.priority]; });
      people = data.people || {};
      if (me && data.me) me = Object.assign(me, data.me);
      paintYou();
      return data;
    }, function (e) {
      if (e && e.code === '42501') checkAccess();
      throw e;
    });
  }

  /* ---------- access gate (same flow as /scuffed_perms) ---------- */

  function social() { return window.GameSocial; }
  function myProfile() { return social() && social().me ? social().me() : null; }

  function whatYouCanDo(level) {
    if (level >= 4) return 'you can add tasks, claim and assign cards, and change their status.';
    if (level >= 3) return 'you can add suggestions and post notes.';
    return 'you can read the board.';
  }

  function gate(state, text) {
    // checking | create | denied | in | offline
    var titles = { checking: 'Checking your access…', denied: 'Scuffed staff only', in: 'You’re in', offline: 'Can’t check your access' };
    $('accountTitle').textContent = titles[state] || '';
    $('accountText').textContent = state === 'denied'
      ? 'The scuffed_dev pages are for players with the moderator role or higher on the moderation panel.' : '';
    show('setup', state === 'create');
    show('hero', state !== 'create');
    show('gate', state !== 'in' && state !== 'create');
    show('masterPanel', state === 'create' || state === 'denied');
    show('recheckRow', state === 'denied' || state === 'offline');
    document.querySelectorAll('[data-staff]').forEach(function (e) { show(e, state === 'in'); });
    show('sdYou', state === 'in');
    if (state === 'in') paintYou();
    if (state === 'create') mountEditor(); else status('createStatus', '');
    status('gateStatus', text || '', state === 'offline' ? 'bad' : '');
    show('gateStatus', !!text);
  }

  // The chip in the hero: your picture, name and level (and the master logout when that's how you're in).
  function paintYou() {
    var box = $('sdYou');
    if (!box || !me) return;
    box.textContent = '';
    var p = me.id ? person(me.id, me.name) : { name: me.name, avatar: null };
    box.appendChild(avatar(p, 28));
    var t = el('span', null);
    t.appendChild(el('strong', null, me.name));
    t.appendChild(document.createTextNode(' · ' + (LEVEL_NAMES[me.level] || 'Staff')));
    box.appendChild(t);
    if (modToken) {
      var out = el('button', 'btn btn-sm btn-ghost', 'Log out of master');
      out.type = 'button';
      out.addEventListener('click', function () {
        var tk = modToken; modToken = null; storeModToken(null);
        (tk && client ? client.rpc('mod_logout', { token: tk }) : Promise.resolve()).then(checkAccess);
      });
      box.appendChild(out);
    }
    box.title = 'As a ' + (LEVEL_NAMES[me.level] || 'staff member').toLowerCase() + ', ' + whatYouCanDo(me.level);
  }

  var editorMounted = false;
  function mountEditor() {
    if (editorMounted || !window.Games || !window.Games.Profile) return;
    editorMounted = true;
    window.Games.Profile.mount($('profileEditor'), function (pr) {
      if (social() && social().localProfileChanged) social().localProfileChanged(pr);
    });
  }

  function createProfile() {
    var btn = $('createProfile');
    btn.disabled = true;
    status('createStatus', 'Creating your profile…');
    var pr = window.Games.Profile.get();
    client.rpc('tetris_me').then(function (r) { return r && !r.error && r.data ? r.data : null; }, function () { return null; }).then(function (id) {
      if (id) return id;
      return client.auth.getSession().then(function (r) { return r.data && r.data.session ? r.data.session.user.id : null; });
    }).then(function (uid) {
      if (!uid) throw new Error('No sign-in yet. Reload and try again.');
      return client.from('tetris_profiles').insert({ id: uid, name: (pr.name || 'Player').slice(0, 16), avatar: pr.avatar || null, equipped: { banner: 'dusk' } }).select().single();
    }).then(function (r) {
      if (r.error && !/duplicate/i.test(r.error.message || '')) throw r.error;
      status('createStatus', 'Profile created.', 'good');
      window.dispatchEvent(new Event('chat:profile-created'));
      var t0 = Date.now();
      (function wait() {
        if (myProfile() || Date.now() - t0 > 8000) { btn.disabled = false; checkAccess(); return; }
        setTimeout(wait, 200);
      })();
    }).catch(function (e) {
      btn.disabled = false;
      status('createStatus', 'Couldn\'t create your profile: ' + errText(e), 'bad');
    });
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
    if (!me) gate('checking');
    return client.rpc('mod_me', { token: modToken }).then(function (r) {
      if (r.error) throw r.error;
      var level = (r.data && r.data.level) || 0;
      if (level >= 2) {
        var first = !me;
        me = Object.assign(me || {}, { level: level, name: (me && me.name) || r.data.actor || 'Staff' });
        if (!('id' in me)) me.id = null;
        gate('in');
        if (opts.onIn) opts.onIn(me, first);
        return;
      }
      var was = !!me;
      me = null;
      if (modToken) { modToken = null; storeModToken(null); }
      gate(myProfile() ? 'denied' : 'create');
      if (was && opts.onOut) opts.onOut();
    }).catch(function (e) {
      gate('offline', 'Couldn\'t check your access: ' + errText(e));
    });
  }

  // Call once when the page has loaded. opts: { onIn(me, firstTime), onOut() }.
  function start(options) {
    opts = options || {};
    on('masterLogin', 'submit', function (e) {
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
    on('recheck', 'click', checkAccess);
    on('createProfile', 'click', createProfile);

    modToken = readModToken();
    gate('checking');
    if (!window.GameSocial || !window.GameSocial.enabled) return gate('offline', 'The site\'s player accounts are switched off on this copy of the site.');
    waitForClient(15000).then(function (c) {
      if (!c) return gate('offline', 'Couldn\'t reach the player account service. Reload to try again.');
      client = c;
      var checked = false;
      window.GameSocial.ready(function () { checked = true; if (!me) checkAccess(); });
      setTimeout(function () { if (!checked) { checked = true; checkAccess(); } }, 2500);
    });
  }

  window.ScuffedDev = {
    STATUSES: STATUSES, STATUS_BY: STATUS_BY, PRIORITY: PRIORITY, LEVEL_NAMES: LEVEL_NAMES, ROLE_NAMES: ROLE_NAMES,
    $: $, el: el, show: show, on: on, time: time, status: status, errText: errText, ago: ago, fullDate: fullDate,
    statusBadge: statusBadge, person: person, avatar: avatar, roleWord: roleWord,
    rpc: rpc, list: list, start: start, checkAccess: checkAccess,
    me: function () { return me; },
    level: function () { return me ? me.level : 0; }
  };
})();
