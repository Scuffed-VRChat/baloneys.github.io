// scuffed_dev/board.js: the Scuffed dev board (kanaris-beans.com/scuffed_dev/board/). Task and suggestion cards for
// the Scuffed VRChat world's development.
//
// Signing in, the staff gate and the shared helpers are in /scuffed_dev/core.js (window.ScuffedDev).
// Who can do what comes from the moderation panel's staff roles:
//   moderator+  read everything          admin+  also add suggestions and notes, edit/delete their own cards
//   dev+        also add tasks, claim, change status, assign devs, edit/delete any card
// The page only hides buttons. The real checks are in the devboard_* database functions
// (supabase/migrations/2026-11-24-scuffed-dev-board.sql), which every action goes through.
//
// Everything on the page is built with textContent: titles, descriptions and notes are never parsed as HTML.
(function () {
  'use strict';

  var VIEW_KEY = 'scuffed-dev-board-view';
  var PAGE_SIZE = 12;
  var POLL_MS = 20000;

  var SD = window.ScuffedDev;
  var STATUSES = SD.STATUSES, STATUS_BY = SD.STATUS_BY, PRIORITY = SD.PRIORITY;
  var $ = SD.$, el = SD.el, show = SD.show, on = SD.on, time = SD.time, status = SD.status, errText = SD.errText;
  var ago = SD.ago, fullDate = SD.fullDate, statusBadge = SD.statusBadge, person = SD.person, avatar = SD.avatar, roleWord = SD.roleWord, rpc = SD.rpc;

  var SORTS = {
    updated: function (a, b) { return time(b.updated_at) - time(a.updated_at); },
    newest: function (a, b) { return time(b.created_at) - time(a.created_at) || b.id - a.id; },
    oldest: function (a, b) { return time(a.created_at) - time(b.created_at) || a.id - b.id; },
    status: function (a, b) { return STATUS_BY[a.status].rank - STATUS_BY[b.status].rank || SORTS.updated(a, b); },
    type: function (a, b) { return (a.kind === b.kind ? 0 : a.kind === 'task' ? -1 : 1) || SORTS.status(a, b); },
    priority: function (a, b) { return PRIORITY[a.priority].rank - PRIORITY[b.priority].rank || SORTS.status(a, b); },
    title: function (a, b) { return a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }); }
  };

  var me = null;            // { level, id, name } once let in
  var items = [];
  var devs = [];
  var timelines = {};       // item id -> updates (oldest first)
  var view = loadView();
  var openId = null;
  var editing = false;
  var pollTimer = 0;
  var loading = false;

  /* ---------- view settings ---------- */

  function loadView() {
    var v = { q: '', kind: 'all', statuses: [], sort: 'updated', mine: false, page: 1 };
    try {
      var s = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
      if (['all', 'task', 'suggestion'].indexOf(s.kind) >= 0) v.kind = s.kind;
      if (SORTS[s.sort]) v.sort = s.sort;
      if (Array.isArray(s.statuses)) v.statuses = s.statuses.filter(function (x) { return STATUS_BY[x]; });
      v.mine = !!s.mine;
    } catch (e) { /* defaults */ }
    return v;
  }

  function saveView() {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ kind: view.kind, sort: view.sort, statuses: view.statuses, mine: view.mine })); } catch (e) { /* fine */ }
  }

  var toastTimer = 0;
  function toast(text, bad) {
    var t = $('dbToast');
    t.textContent = text;
    t.className = 'db-toast is-on' + (bad ? ' is-bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'db-toast' + (bad ? ' is-bad' : ''); }, bad ? 5000 : 2600);
  }

  /* ---------- permissions (mirrors the database; the database decides) ---------- */

  function lv() { return me ? me.level : 0; }
  function canSuggest() { return lv() >= 3; }
  function canTask() { return lv() >= 4; }
  function canWork() { return lv() >= 4; }
  function canNote() { return lv() >= 3; }
  function owns(it) { return !!(me && me.id && it.created_by === me.id); }
  function canEdit(it) { return lv() >= 4 || (lv() >= 3 && owns(it)); }

  /* ---------- people ---------- */

  // Who the card's corner shows: whoever has it, otherwise whoever made it.
  function cornerPerson(it) {
    if (it.assignee) return { p: person(it.assignee), claimed: true };
    return { p: person(it.created_by, it.created_by_name), claimed: false };
  }

  /* ---------- the database ---------- */

  function load(quiet) {
    if (!me || loading) return Promise.resolve();
    loading = true;
    if (!quiet && !items.length) skeleton();
    return SD.list().then(function (data) {
      me = SD.me() || me;
      items = data.items;
      devs = data.devs || [];
      status('loadStatus', '');
      render();
      if (openId != null) {
        var it = find(openId);
        if (!it) { closeDetail(); toast('That card was deleted.'); }
        else if (!editing) refreshDetail(it);
      }
    }).catch(function (e) {
      status('loadStatus', 'Couldn\'t load the board: ' + errText(e), 'bad');
    }).then(function () { loading = false; });
  }

  function find(id) { for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i]; return null; }

  function act(promise, okText, btn) {
    if (btn) btn.disabled = true;
    return promise.then(function (res) {
      if (okText) toast(okText);
      return load(true).then(function () { return res; });
    }).catch(function (e) {
      toast(errText(e), true);
      var it = openId != null && find(openId);
      if (it && !editing) refreshDetail(it);   // put the pickers back to what's really saved
      throw e;
    }).then(function (res) { if (btn) btn.disabled = false; return res; }, function () { if (btn) btn.disabled = false; });
  }

  /* ---------- the board: filters, sort, paging ---------- */

  function filtered() {
    var q = view.q.trim().toLowerCase();
    var words = q ? q.split(/\s+/) : [];
    var list = items.filter(function (it) {
      if (view.kind !== 'all' && it.kind !== view.kind) return false;
      if (view.statuses.length && view.statuses.indexOf(it.status) < 0) return false;
      if (view.mine && !(me && me.id && (it.assignee === me.id || it.created_by === me.id))) return false;
      if (!words.length) return true;
      var hay = [it.title, it.body, '#' + it.id, person(it.assignee).name, it.created_by_name, STATUS_BY[it.status].label, it.kind]
        .join(' ').toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    return list.sort(SORTS[view.sort] || SORTS.updated);
  }

  function skeleton() {
    var g = $('dbGrid');
    g.textContent = '';
    for (var i = 0; i < 6; i++) g.appendChild(el('div', 'db-skel'));
  }

  function render() {
    renderStats();
    renderControls();
    var list = filtered();
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (view.page > pages) view.page = pages;
    if (view.page < 1) view.page = 1;
    var start = (view.page - 1) * PAGE_SIZE;
    var slice = list.slice(start, start + PAGE_SIZE);

    var g = $('dbGrid');
    g.textContent = '';
    if (!slice.length) {
      var empty = el('div', 'db-empty');
      if (!items.length) {
        empty.appendChild(el('strong', null, 'The board is empty'));
        empty.appendChild(el('span', null, canTask() ? 'Add the first task with New task.' : canSuggest() ? 'Add the first suggestion with New suggestion.' : 'Nothing has been added yet.'));
      } else {
        empty.appendChild(el('strong', null, 'No cards match'));
        empty.appendChild(el('span', null, 'Try a different search or clear the filters.'));
      }
      g.appendChild(empty);
    }
    slice.forEach(function (it) { g.appendChild(card(it)); });

    var filteredOn = view.q.trim() || view.kind !== 'all' || view.statuses.length || view.mine;
    $('dbCount').textContent = list.length
      ? 'Showing ' + (start + 1) + '–' + (start + slice.length) + ' of ' + list.length + (filteredOn ? ' (filtered from ' + items.length + ')' : '')
      : '';
    show('dbClear', !!filteredOn);
    renderPager(pages);
  }

  function renderStats() {
    var box = $('dbStats');
    box.textContent = '';
    box.classList.toggle('is-filtering', view.statuses.length > 0);
    var scope = items.filter(function (it) { return view.kind === 'all' || it.kind === view.kind; });
    STATUSES.forEach(function (s) {
      var n = scope.filter(function (it) { return it.status === s.id; }).length;
      var b = el('button', 'db-stat st-' + s.id);
      b.type = 'button';
      b.setAttribute('aria-pressed', view.statuses.indexOf(s.id) >= 0 ? 'true' : 'false');
      b.title = 'Show only ' + s.label.toLowerCase() + ' cards (click more than one to combine)';
      b.appendChild(el('span', 'db-stat-count', String(n)));
      var l = el('span', 'db-stat-label');
      l.appendChild(el('i', null, s.sym));
      l.appendChild(document.createTextNode(s.label));
      b.appendChild(l);
      b.addEventListener('click', function () {
        var i = view.statuses.indexOf(s.id);
        if (i >= 0) view.statuses.splice(i, 1); else view.statuses.push(s.id);
        view.page = 1; saveView(); render();
      });
      box.appendChild(b);
    });
  }

  function renderControls() {
    document.querySelectorAll('#dbKind button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-kind') === view.kind ? 'true' : 'false'); });
    $('dbSort').value = view.sort;
    $('dbMine').setAttribute('aria-pressed', view.mine ? 'true' : 'false');
    show('dbMine', !!(me && me.id));
    show('dbNewTask', canTask());
    show('dbNewSuggestion', canSuggest());
  }

  function renderPager(pages) {
    var p = $('dbPager');
    p.textContent = '';
    show(p, pages > 1);
    if (pages <= 1) return;
    function btn(label, page, aria, disabled) {
      var b = el('button', 'db-page', label);
      b.type = 'button';
      if (aria) b.setAttribute('aria-label', aria);
      if (page === view.page && !aria) b.setAttribute('aria-current', 'page');
      b.disabled = !!disabled;
      b.addEventListener('click', function () { view.page = page; render(); $('dbBoardTop').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      p.appendChild(b);
    }
    btn('‹', view.page - 1, 'Previous page', view.page === 1);
    var shown = {};
    [1, 2, view.page - 1, view.page, view.page + 1, pages - 1, pages].forEach(function (n) { if (n >= 1 && n <= pages) shown[n] = 1; });
    var last = 0;
    Object.keys(shown).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
      if (n - last > 1) p.appendChild(el('span', 'db-page-gap', '…'));
      btn(String(n), n);
      last = n;
    });
    btn('›', view.page + 1, 'Next page', view.page === pages);
  }

  function tags(it, box) {
    box.appendChild(el('span', 'db-tag db-tag-id', '#' + it.id));
    box.appendChild(el('span', 'db-tag is-' + it.kind, it.kind === 'task' ? 'Task' : 'Suggestion'));
    if (it.priority !== 'normal') box.appendChild(el('span', 'db-tag is-' + it.priority, PRIORITY[it.priority].label + ' priority'));
  }

  var ICON_NOTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

  function card(it) {
    var c = el('article', 'db-card st-' + it.status);
    c.tabIndex = 0;
    c.setAttribute('role', 'button');
    c.setAttribute('aria-label', (it.kind === 'task' ? 'Task' : 'Suggestion') + ' #' + it.id + ': ' + it.title + ', ' + STATUS_BY[it.status].label);

    var top = el('div', 'db-card-top');
    tags(it, top);
    c.appendChild(top);

    var corner = cornerPerson(it);
    var cw = el('span', 'db-corner' + (corner.claimed ? '' : ' is-creator'));
    cw.title = (corner.claimed ? 'Claimed by ' : 'Created by ') + corner.p.name;
    cw.appendChild(avatar(corner.p, 34));
    c.appendChild(cw);

    c.appendChild(el('h3', 'db-card-title', it.title));
    if (it.body) c.appendChild(el('p', 'db-card-body', it.body));

    var foot = el('div', 'db-card-foot');
    foot.appendChild(statusBadge(it.status));
    if (it.notes) {
      var n = el('span');
      n.title = it.notes + (it.notes === 1 ? ' note' : ' notes');
      n.insertAdjacentHTML('afterbegin', ICON_NOTE);   // a fixed icon, not user text
      n.appendChild(document.createTextNode(' ' + it.notes));
      foot.appendChild(n);
    }
    foot.appendChild(el('span', 'db-spacer'));
    if (canWork() && !it.assignee && it.status !== 'complete' && me && me.id) {
      var claim = el('button', 'db-claim', 'Claim');
      claim.type = 'button';
      claim.setAttribute('aria-label', 'Claim #' + it.id);
      claim.addEventListener('click', function (e) {
        e.stopPropagation();
        act(rpc('devboard_assign', { item: it.id, who: me.id }), 'Claimed #' + it.id + '.', claim);
      });
      foot.appendChild(claim);
    } else {
      var when = el('span', null, ago(it.updated_at));
      when.title = 'Last update ' + fullDate(it.updated_at) + (it.updated_by_name ? ' by ' + it.updated_by_name : '');
      foot.appendChild(when);
    }
    c.appendChild(foot);

    c.addEventListener('click', function () { openDetail(it.id); });
    c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(it.id); } });
    return c;
  }

  /* ---------- the full card ---------- */

  function openDetail(id) {
    var it = find(id);
    if (!it) return;
    openId = id;
    editing = false;
    if (location.hash !== '#card-' + id) history.replaceState(null, '', '#card-' + id);
    refreshDetail(it);
    var d = $('dbDetail');
    if (!d.open) d.showModal();
    loadTimeline(id);
  }

  function closeDetail() {
    openId = null;
    editing = false;
    var d = $('dbDetail');
    if (d.open) d.close();
    if (/^#card-/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  }

  function loadTimeline(id) {
    return rpc('devboard_updates', { item: id }).then(function (list) {
      timelines[id] = list || [];
      if (openId === id) renderTimeline(find(id));
    }).catch(function (e) {
      if (openId === id) { var tl = $('dbTimeline'); tl.textContent = ''; tl.appendChild(el('li', 'perms-status is-bad', 'Couldn\'t load the updates: ' + errText(e))); }
    });
  }

  function refreshDetail(it) {
    var d = $('dbDetail');
    STATUSES.forEach(function (s) { d.classList.remove('st-' + s.id); });
    d.classList.add('st-' + it.status);

    var t = $('dbDetailTags'); t.textContent = '';
    tags(it, t);
    t.appendChild(statusBadge(it.status));
    $('dbDetailTitle').textContent = it.title;

    show('dbDetailView', !editing);
    show('dbDetailEdit', editing);
    var desc = $('dbDetailDesc');
    desc.textContent = it.body || 'No description.';
    desc.classList.toggle('is-empty', !it.body);

    renderSide(it);
    renderTimeline(it);
    show('dbNoteForm', canNote());
  }

  function renderSide(it) {
    var side = $('dbDetailSide');
    side.textContent = '';

    // Status + who's on it: developers can change them, everyone else sees them.
    var stField = el('div', 'db-field');
    stField.appendChild(el('span', 'db-h', 'Status'));
    if (canWork()) {
      var sel = el('select', 'db-select');
      sel.setAttribute('aria-label', 'Status');
      STATUSES.forEach(function (s) { var o = el('option', null, s.sym + '  ' + s.label); o.value = s.id; sel.appendChild(o); });
      sel.value = it.status;
      sel.addEventListener('change', function () {
        var v = sel.value;
        act(rpc('devboard_set_status', { item: it.id, new_status: v }), 'Moved to ' + STATUS_BY[v].label + '.', sel).then(function () { loadTimeline(it.id); });
      });
      stField.appendChild(sel);
    } else stField.appendChild(statusBadge(it.status));
    side.appendChild(stField);

    var asField = el('div', 'db-field');
    asField.appendChild(el('span', 'db-h', 'Assigned to'));
    if (it.assignee) asField.appendChild(personRow(person(it.assignee), 'Claimed'));
    else asField.appendChild(el('span', 'db-person-sub', 'Nobody yet'));
    if (canWork()) {
      var pick = el('select', 'db-select');
      pick.setAttribute('aria-label', 'Assign to');
      var none = el('option', null, 'Nobody'); none.value = ''; pick.appendChild(none);
      var ids = devs.slice();
      if (me && me.id && ids.indexOf(me.id) < 0) ids.unshift(me.id);
      if (it.assignee && ids.indexOf(it.assignee) < 0) ids.push(it.assignee);
      ids.forEach(function (uid) {
        var o = el('option', null, person(uid).name + (me && uid === me.id ? ' (you)' : ''));
        o.value = uid; pick.appendChild(o);
      });
      pick.value = it.assignee || '';
      pick.addEventListener('change', function () {
        var who = pick.value || null;
        act(rpc('devboard_assign', { item: it.id, who: who }), who ? 'Assigned to ' + person(who).name + '.' : 'Unassigned.', pick).then(function () { loadTimeline(it.id); });
      });
      asField.appendChild(pick);
      if (me && me.id) {
        var mine = it.assignee === me.id;
        var cb = el('button', 'btn btn-sm ' + (mine ? 'btn-outline' : 'btn-primary'), mine ? 'Unclaim' : it.assignee ? 'Take it over' : 'Claim it');
        cb.type = 'button';
        cb.addEventListener('click', function () {
          act(rpc('devboard_assign', { item: it.id, who: mine ? null : me.id }), mine ? 'Unclaimed.' : 'Claimed.', cb).then(function () { loadTimeline(it.id); });
        });
        asField.appendChild(cb);
      }
    }
    side.appendChild(asField);

    var cr = el('div', 'db-field');
    cr.appendChild(el('span', 'db-h', 'Created by'));
    var creator = person(it.created_by, it.created_by_name);
    cr.appendChild(personRow(creator, roleWord(creator, it.created_by_name) + ' · ' + ago(it.created_at), fullDate(it.created_at)));
    side.appendChild(cr);

    var lu = el('div', 'db-field');
    lu.appendChild(el('span', 'db-h', 'Last update'));
    var upd = person(it.updated_by, it.updated_by_name);
    lu.appendChild(personRow(upd, ago(it.updated_at), fullDate(it.updated_at)));
    if (it.last && it.last.body) {
      var what = el('span', 'db-person-sub', it.last.kind === 'note' ? '“' + it.last.body + (it.last.body.length >= 160 ? '…' : '') + '”' : it.last.author_name + ' ' + it.last.body);
      lu.appendChild(what);
    }
    side.appendChild(lu);

    var pr = el('div', 'db-field');
    pr.appendChild(el('span', 'db-h', 'Priority'));
    pr.appendChild(el('span', 'db-person-sub', PRIORITY[it.priority].label));
    side.appendChild(pr);

    var buttons = el('div', 'db-side-buttons');
    if (canEdit(it)) {
      var eb = el('button', 'btn btn-sm btn-outline', 'Edit');
      eb.type = 'button';
      eb.addEventListener('click', function () { startEdit(it); });
      buttons.appendChild(eb);
    }
    if (canWork()) {
      var kb = el('button', 'btn btn-sm btn-outline', it.kind === 'suggestion' ? 'Make it a task' : 'Make it a suggestion');
      kb.type = 'button';
      kb.addEventListener('click', function () {
        var to = it.kind === 'suggestion' ? 'task' : 'suggestion';
        act(rpc('devboard_set_kind', { item: it.id, new_kind: to }), 'It\'s a ' + to + ' now.', kb).then(function () { loadTimeline(it.id); });
      });
      buttons.appendChild(kb);
    }
    if (canEdit(it)) {
      var db = el('button', 'btn btn-sm btn-outline db-danger', 'Delete');
      db.type = 'button';
      db.addEventListener('click', function () {
        if (!confirm('Delete #' + it.id + ' "' + it.title + '" and all its notes? This can\'t be undone.')) return;
        act(rpc('devboard_delete', { item: it.id }), 'Deleted #' + it.id + '.', db).then(function () { closeDetail(); });
      });
      buttons.appendChild(db);
    }
    if (buttons.childNodes.length) side.appendChild(buttons);
  }

  function personRow(p, sub, subTitle) {
    var row = el('div', 'db-person');
    row.appendChild(avatar(p, 36));
    var info = el('div', 'db-person-info');
    info.appendChild(el('span', 'db-person-name', p.name));
    var s = el('span', 'db-person-sub', sub || '');
    if (subTitle) s.title = subTitle;
    info.appendChild(s);
    row.appendChild(info);
    return row;
  }

  function renderTimeline(it) {
    var tl = $('dbTimeline');
    var list = timelines[it.id];
    tl.textContent = '';
    if (!list) { tl.appendChild(el('li', 'db-person-sub', 'Loading updates…')); return; }
    if (!list.length) { tl.appendChild(el('li', 'db-person-sub', 'No updates yet.')); return; }
    list.slice().reverse().forEach(function (u) {
      var li = el('li', 'db-tl is-' + u.kind);
      var p = person(u.author, u.author_name);
      if (u.kind === 'note') li.appendChild(avatar(p, 32));
      else li.appendChild(el('span', 'db-dot', '•'));
      var box = el('div');
      var who = el('div', 'db-tl-who');
      who.appendChild(el('strong', null, u.author_name || p.name));
      who.appendChild(document.createTextNode(u.kind === 'note' ? ' posted a note' : ' ' + u.body));
      box.appendChild(who);
      var when = el('div', 'db-tl-when', ago(u.created_at));
      when.title = fullDate(u.created_at);
      box.appendChild(when);
      if (u.kind === 'note') box.appendChild(el('div', 'db-tl-note', u.body));
      li.appendChild(box);
      tl.appendChild(li);
    });
  }

  function startEdit(it) {
    editing = true;
    $('dbEditTitle').value = it.title;
    $('dbEditBody').value = it.body;
    $('dbEditPriority').value = it.priority;
    counter('dbEditBody', 'dbEditBodyCount', 4000);
    status('dbEditStatus', '');
    refreshDetail(it);
    $('dbEditTitle').focus();
  }

  function counter(inputId, countId, max) {
    var n = $(inputId).value.length;
    $(countId).textContent = n + ' / ' + max;
  }

  /* ---------- new card ---------- */

  function openNew(kind) {
    var f = $('dbNewForm');
    f.reset();
    $('dbNewKind').value = kind;
    $('dbNewHeading').textContent = kind === 'task' ? 'New task' : 'New suggestion';
    $('dbNewLead').textContent = kind === 'task'
      ? 'Something a developer will build, fix or set up in the world.'
      : 'An idea for the world. A developer can pick it up and turn it into a task.';
    show('dbNewAssignField', canWork());
    var pick = $('dbNewAssign');
    pick.textContent = '';
    var none = el('option', null, 'Nobody (unclaimed)'); none.value = ''; pick.appendChild(none);
    if (canWork()) {
      var ids = devs.slice();
      if (me && me.id && ids.indexOf(me.id) < 0) ids.unshift(me.id);
      ids.forEach(function (uid) { var o = el('option', null, person(uid).name + (me && uid === me.id ? ' (you)' : '')); o.value = uid; pick.appendChild(o); });
    }
    counter('dbNewBody', 'dbNewBodyCount', 4000);
    status('dbNewStatus', '');
    $('dbNew').showModal();
    $('dbNewTitle').focus();
  }

  function openFromHash() {
    // #in_progress etc. (from the hub): show just that phase
    var st = location.hash.slice(1);
    if (STATUS_BY[st]) {
      view.statuses = [st]; view.kind = 'all'; view.mine = false; view.q = ''; $('dbSearch').value = ''; view.page = 1;
      saveView(); render();
      history.replaceState(null, '', location.pathname + location.search);
      return;
    }
    var m = /^#card-(\d+)$/.exec(location.hash);
    if (m && find(Number(m[1]))) openDetail(Number(m[1]));
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      if (document.hidden || !me) return;
      load(true);
      if (openId != null && !editing) loadTimeline(openId);
    }, POLL_MS);
  }
  function stopPolling() { clearInterval(pollTimer); pollTimer = 0; }

  /* ---------- boot ---------- */

  function boot() {
    var searchTimer = 0;
    on('dbSearch', 'input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { view.q = $('dbSearch').value; view.page = 1; render(); }, 120);
    });
    document.querySelectorAll('#dbKind button').forEach(function (b) {
      b.addEventListener('click', function () { view.kind = b.getAttribute('data-kind'); view.page = 1; saveView(); render(); });
    });
    on('dbSort', 'change', function () { view.sort = $('dbSort').value; view.page = 1; saveView(); render(); });
    on('dbMine', 'click', function () { view.mine = !view.mine; view.page = 1; saveView(); render(); });
    on('dbClear', 'click', function () { view.q = ''; $('dbSearch').value = ''; view.kind = 'all'; view.statuses = []; view.mine = false; view.page = 1; saveView(); render(); });
    on('dbRefresh', 'click', function () { load(); });
    on('dbNewTask', 'click', function () { openNew('task'); });
    on('dbNewSuggestion', 'click', function () { openNew('suggestion'); });

    on('dbNewBody', 'input', function () { counter('dbNewBody', 'dbNewBodyCount', 4000); });
    on('dbEditBody', 'input', function () { counter('dbEditBody', 'dbEditBodyCount', 4000); });

    on('dbNewForm', 'submit', function (e) {
      e.preventDefault();
      var title = $('dbNewTitle').value.trim();
      if (!title) { status('dbNewStatus', 'Give it a title.', 'bad'); return; }
      var kind = $('dbNewKind').value;
      var btn = $('dbNewSubmit');
      btn.disabled = true;
      status('dbNewStatus', 'Adding…');
      rpc('devboard_create', {
        item_kind: kind, item_title: title, item_body: $('dbNewBody').value,
        item_priority: $('dbNewPriority').value, item_assignee: (canWork() && $('dbNewAssign').value) || null
      }).then(function (id) {
        $('dbNew').close();
        toast((kind === 'task' ? 'Task' : 'Suggestion') + ' #' + id + ' added.');
        view.page = 1;
        return load(true).then(function () { openDetail(Number(id)); });
      }).catch(function (err) {
        status('dbNewStatus', errText(err), 'bad');
      }).then(function () { btn.disabled = false; });
    });
    on('dbNewCancel', 'click', function () { $('dbNew').close(); });
    on('dbNewX', 'click', function () { $('dbNew').close(); });

    on('dbDetailEdit', 'submit', function (e) {
      e.preventDefault();
      var it = find(openId);
      if (!it) return;
      var btn = $('dbEditSave');
      btn.disabled = true;
      status('dbEditStatus', 'Saving…');
      rpc('devboard_edit', { item: it.id, item_title: $('dbEditTitle').value, item_body: $('dbEditBody').value, item_priority: $('dbEditPriority').value })
        .then(function () {
          editing = false;
          status('dbEditStatus', '');
          toast('Saved.');
          return load(true).then(function () { loadTimeline(it.id); });
        }).catch(function (err) { status('dbEditStatus', errText(err), 'bad'); })
        .then(function () { btn.disabled = false; });
    });
    on('dbEditCancel', 'click', function () { editing = false; var it = find(openId); if (it) refreshDetail(it); });

    on('dbNoteForm', 'submit', function (e) {
      e.preventDefault();
      var it = find(openId);
      var ta = $('dbNoteText');
      var text = ta.value.trim();
      if (!it || !text) return;
      var btn = $('dbNoteSend');
      btn.disabled = true;
      rpc('devboard_note', { item: it.id, note: text }).then(function () {
        ta.value = '';
        counter('dbNoteText', 'dbNoteCount', 2000);
        return Promise.all([load(true), loadTimeline(it.id)]);
      }).catch(function (err) { toast(errText(err), true); }).then(function () { btn.disabled = false; });
    });
    on('dbNoteText', 'input', function () { counter('dbNoteText', 'dbNoteCount', 2000); });
    on('dbNoteText', 'keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('dbNoteSend').click(); } });

    on('dbDetailX', 'click', closeDetail);
    $('dbDetail').addEventListener('close', function () { if (openId != null) closeDetail(); });
    [$('dbDetail'), $('dbNew')].forEach(function (d) {
      // a click on the dimmed backdrop (the dialog element itself, outside its content) closes it
      d.addEventListener('mousedown', function (e) { d._downOnSelf = e.target === d; });
      d.addEventListener('click', function (e) { if (e.target === d && d._downOnSelf) { if (d.id === 'dbDetail') closeDetail(); else d.close(); } });
    });
    window.addEventListener('hashchange', function () { if (me) { if (/^#card-/.test(location.hash) || STATUS_BY[location.hash.slice(1)]) openFromHash(); else if (openId != null) closeDetail(); } });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && me) load(true); });
    setInterval(function () { if (me && !document.hidden) render(); }, 60000);   // keeps "3m ago" honest

    $('dbSearch').value = view.q;
    SD.start({
      onIn: function (who, first) {
        me = who;
        load().then(function () { if (first) { openFromHash(); startPolling(); } });
      },
      onOut: function () { me = null; stopPolling(); closeDetail(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
