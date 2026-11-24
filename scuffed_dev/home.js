// scuffed_dev/home.js: the scuffed_dev hub (kanaris-beans.com/scuffed_dev/). Your own stats and the open
// suggestion count up top, the scuffed_dev pages, your active cards, and how many tasks sit in each phase.
// Read-only: every change happens on the board. Signing in and the data come from /scuffed_dev/core.js.
(function () {
  'use strict';

  var SD = window.ScuffedDev;
  var $ = SD.$, el = SD.el, show = SD.show;
  var POLL_MS = 30000;
  var BOARD = '/scuffed_dev/board/';

  // The pages this hub links to, and the level each one needs (it checks again itself).
  var PAGES = [
    { href: BOARD, name: 'Dev board', desc: 'Tasks and suggestions for the world: claim, assign, move them through each phase.', need: 2 },
    { href: '/scuffed_perms/', name: 'Permissions', desc: 'Who holds which role in the world. The world picks changes up within 5–10 minutes.', need: 3 },
    { href: '/announcements/', name: 'Announcements', desc: 'The spawn board text and lobby notifications for Scuffed and Straya.', need: 2 },
    { href: '/moderation.html', name: 'Moderation', desc: 'Reports, bans, the chat filter and staff roles for the site.', need: 1 }
  ];

  var data = null;
  var timer = 0;

  function isMine(it, me) { return !!(me && me.id && it.assignee === me.id); }

  function stat(label, value, sub, cls) {
    var b = el('div', 'hub-stat' + (cls ? ' ' + cls : ''));
    b.appendChild(el('span', 'hub-stat-value', String(value)));
    b.appendChild(el('span', 'hub-stat-label', label));
    if (sub) b.appendChild(el('span', 'hub-stat-sub', sub));
    return b;
  }

  // The strip above everything: you, your numbers, and the open suggestions.
  function renderHeader() {
    var me = SD.me();
    var items = data.items;
    var box = $('hubMe');
    box.textContent = '';
    var who = el('div', 'hub-who');
    var p = me.id ? SD.person(me.id, me.name) : { name: me.name, avatar: null };
    who.appendChild(SD.avatar(p, 44));
    var t = el('div', 'hub-who-text');
    t.appendChild(el('strong', null, me.name));
    t.appendChild(el('span', null, (SD.LEVEL_NAMES[me.level] || 'Staff') + (me.id ? '' : ' · no profile in this browser')));
    who.appendChild(t);
    box.appendChild(who);

    var mine = items.filter(function (it) { return isMine(it, me); });
    var active = mine.filter(function (it) { return it.status !== 'complete'; });
    var stats = el('div', 'hub-stats');
    stats.appendChild(stat('Active', active.length, active.filter(function (it) { return it.status === 'in_progress'; }).length + ' in progress', 'st-in_progress'));
    stats.appendChild(stat('In testing', mine.filter(function (it) { return it.status === 'testing'; }).length, 'yours', 'st-testing'));
    stats.appendChild(stat('Completed', mine.filter(function (it) { return it.status === 'complete'; }).length, 'yours', 'st-complete'));
    stats.appendChild(stat('Created', items.filter(function (it) { return me.id && it.created_by === me.id; }).length, 'cards you added', 'st-claimed'));
    var sugg = items.filter(function (it) { return it.kind === 'suggestion'; });
    var open = sugg.filter(function (it) { return it.status !== 'complete'; });
    stats.appendChild(stat('Suggestions', open.length, 'open · ' + sugg.length + ' total', 'is-suggestions'));
    box.appendChild(stats);
  }

  function renderPages() {
    var grid = $('hubPages');
    if (grid.childNodes.length && grid.getAttribute('data-level') === String(SD.level())) return;
    grid.setAttribute('data-level', String(SD.level()));
    grid.textContent = '';
    PAGES.forEach(function (pg) {
      var locked = SD.level() < pg.need;
      var a = el('a', 'hub-page' + (locked ? ' is-locked' : ''));
      a.href = pg.href;
      var head = el('div', 'hub-page-head');
      head.appendChild(el('h3', null, pg.name));
      head.appendChild(el('span', 'db-tag', locked ? 'Needs ' + SD.LEVEL_NAMES[pg.need] : SD.LEVEL_NAMES[pg.need] + '+'));
      a.appendChild(head);
      a.appendChild(el('p', null, pg.desc));
      a.appendChild(el('span', 'hub-page-go', locked ? 'You can look, but it will ask for a higher role' : 'Open →'));
      grid.appendChild(a);
    });
  }

  // Your cards that aren't finished, the furthest-along first.
  function renderActive() {
    var me = SD.me();
    var list = data.items.filter(function (it) { return isMine(it, me) && it.status !== 'complete'; })
      .sort(function (a, b) { return SD.STATUS_BY[b.status].rank - SD.STATUS_BY[a.status].rank || SD.time(b.updated_at) - SD.time(a.updated_at); });
    var ul = $('hubActive');
    ul.textContent = '';
    $('hubActiveCount').textContent = list.length ? String(list.length) : '';
    if (!me.id) { ul.appendChild(el('li', 'hub-empty', 'You\'re signed in with the master login only, so nothing is assigned to you here.')); return; }
    if (!list.length) {
      var li = el('li', 'hub-empty');
      li.appendChild(document.createTextNode(SD.level() >= 4 ? 'Nothing on your plate. ' : 'Nothing is assigned to you. '));
      var a = el('a', null, SD.level() >= 4 ? 'Find something to claim' : 'Browse the board');
      a.href = BOARD + (SD.level() >= 4 ? '#unclaimed' : '');
      li.appendChild(a);
      ul.appendChild(li);
      return;
    }
    list.slice(0, 8).forEach(function (it) {
      var li = el('li');
      var a = el('a', 'hub-item st-' + it.status);
      a.href = BOARD + '#card-' + it.id;
      var top = el('div', 'hub-item-top');
      top.appendChild(el('span', 'db-tag db-tag-id', '#' + it.id));
      top.appendChild(el('span', 'db-tag is-' + it.kind, it.kind === 'task' ? 'Task' : 'Suggestion'));
      if (it.priority === 'high') top.appendChild(el('span', 'db-tag is-high', 'High priority'));
      a.appendChild(top);
      a.appendChild(el('span', 'hub-item-title', it.title));
      var foot = el('div', 'hub-item-foot');
      foot.appendChild(SD.statusBadge(it.status));
      var when = el('span', null, 'updated ' + SD.ago(it.updated_at));
      when.title = SD.fullDate(it.updated_at);
      foot.appendChild(when);
      a.appendChild(foot);
      li.appendChild(a);
      ul.appendChild(li);
    });
    if (list.length > 8) {
      var more = el('li', 'hub-empty');
      var m = el('a', null, 'and ' + (list.length - 8) + ' more on the board');
      m.href = BOARD;
      more.appendChild(m);
      ul.appendChild(more);
    }
  }

  // Everyone's tasks per phase, as bars. Suggestions are counted in the header instead.
  function renderPhases() {
    var tasks = data.items.filter(function (it) { return it.kind === 'task'; });
    var max = 1;
    var counts = SD.STATUSES.map(function (s) {
      var n = tasks.filter(function (it) { return it.status === s.id; }).length;
      if (n > max) max = n;
      return n;
    });
    var box = $('hubPhases');
    box.textContent = '';
    SD.STATUSES.forEach(function (s, i) {
      var row = el('a', 'hub-phase st-' + s.id);
      row.href = BOARD + '#' + s.id;
      row.title = 'Show ' + s.label.toLowerCase() + ' cards on the board';
      var label = el('span', 'hub-phase-label');
      label.appendChild(el('i', null, s.sym));
      label.appendChild(document.createTextNode(s.label));
      row.appendChild(label);
      var bar = el('span', 'hub-phase-bar');
      var fill = el('span', 'hub-phase-fill');
      fill.style.width = (counts[i] ? Math.max(4, Math.round(counts[i] / max * 100)) : 0) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el('span', 'hub-phase-n', String(counts[i])));
      box.appendChild(row);
    });
    var done = counts[4];
    $('hubPhaseTotal').textContent = tasks.length
      ? tasks.length + ' tasks · ' + Math.round(done / tasks.length * 100) + '% complete'
      : 'No tasks yet';
    var meter = $('hubProgress');
    meter.style.setProperty('--pct', (tasks.length ? done / tasks.length * 100 : 0) + '%');
    meter.setAttribute('aria-valuenow', String(tasks.length ? Math.round(done / tasks.length * 100) : 0));
  }

  function render() {
    renderHeader();
    renderPages();
    renderActive();
    renderPhases();
  }

  function load() {
    return SD.list().then(function (d) {
      data = d;
      SD.status('hubStatus', '');
      render();
    }).catch(function (e) {
      SD.status('hubStatus', 'Couldn\'t load the board: ' + SD.errText(e), 'bad');
    });
  }

  function boot() {
    // old links to a card on the hub address go to the board
    if (/^#card-\d+$/.test(location.hash)) { location.replace(BOARD + location.hash); return; }
    SD.start({
      onIn: function (me, first) {
        load();
        if (first) {
          clearInterval(timer);
          timer = setInterval(function () { if (!document.hidden && SD.me()) load(); }, POLL_MS);
        }
      },
      onOut: function () { clearInterval(timer); data = null; }
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && SD.me() && data) load(); });
    show('hubStatus', true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
