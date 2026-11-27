// scuffed_dev/deploy.js: the deploy watcher, on every scuffed_dev page (bottom-right corner).
//
// Every scuffed_dev page that saves (world images, permissions, announcements) commits to the ONE site repo, and
// GitHub Pages rebuilds kanaris-beans.com after each commit. This follows each commit until its files are really
// being served:
//
//   Saved  ->  Building (GitHub Pages)  ->  Checking the live site  ->  Live ✓
//
// "Live" is verified, not assumed: each changed file is downloaded from kanaris-beans.com and its git blob sha is
// worked out in the browser; it must equal the sha that was committed (a deleted file must be gone). Because all
// pages share the repo:
//   - a build GitHub skipped because a newer commit came first is fine, as long as a later build carried the files;
//   - a file a newer commit changed again (any page, anyone) ends the watch as "replaced", not "stuck";
//   - the list lives in localStorage, shared by every open scuffed_dev tab; only one tab checks a commit at a time;
//   - "Re-deploy" (an empty commit so Pages builds again) has one shared cooldown, so it can't be spammed.
// A save that failed before it became a commit shows a Retry button that re-sends exactly that save (this tab only:
// the save's data lives in memory).
//
//   ScuffedDeploy.watch({ commit, live: [{ path, sha|null }], label })
//   ScuffedDeploy.saveFailed({ label, error, retry })
(function () {
  'use strict';
  if (window.ScuffedDeploy) return;

  var WORKER = 'https://scuffed-perms.seanboyle20126.workers.dev';
  var COMMIT_URL = 'https://github.com/Scuffed-VRChat/baloneys.github.io/commit/';
  var MOD_TOKEN_KEY = 'balcade-mod-token';
  var KEY = 'scd-deploys-v1';
  var COOLDOWN_KEY = 'scd-redeploy-at';
  var MAX = 12;
  var TICK_MS = 3000;           // refresh the shared site queue while this page is visible
  var POLL_MS = 8000;           // how often one commit is checked (by whichever tab gets there first)
  var LOCK_MS = 15000;          // a tab "holding" a check; another tab takes over if it stops
  var STALL_MS = 12 * 60000;    // not live after this long: offer Re-deploy
  var KEEP_DONE_MS = 3 * 60000; // finished ones stay listed this long
  var COOLDOWN_MS = 2 * 60000;  // between re-deploys, across all pages
  var ACTIVE = { waiting: 1, building: 1, checking: 1 };

  // <html data-deploy-ui="none">: the scuffed_dev app draws its own Deploys screen; no corner pill, same watcher.
  var headless = document.documentElement.getAttribute('data-deploy-ui') === 'none';
  var listeners = [];
  var tab = Math.random().toString(36).slice(2, 10);
  var retries = {};             // entry id -> function (this tab only)
  var expanded = false;
  var ui = null;
  var site = { data: null, error: null };
  var siteRequest = null;
  var showSiteUntil = 0;
  var lastRender = '';
  var lastPanel = '';

  /* ---------- the shared list ---------- */

  function now() { return Date.now(); }
  function read() { try { var v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function write(list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch (e) { /* private mode: this tab only */ mem = list; } render(); }
  var mem = null;
  function list() { return mem || read(); }
  function change(id, fn) {
    var l = list();
    var e = l.filter(function (x) { return x.id === id; })[0];
    if (!e) return null;
    fn(e);
    write(l);
    return e;
  }
  function add(e) { var l = list(); l.push(e); write(l); }
  function remove(id) { write(list().filter(function (x) { return x.id !== id; })); delete retries[id]; }
  function cooldownLeft() { var t = 0; try { t = Number(localStorage.getItem(COOLDOWN_KEY)) || 0; } catch (e) { /* fine */ } return Math.max(0, COOLDOWN_MS - (now() - t)); }

  /* ---------- talking to the Worker ---------- */

  function accessToken() {
    var c = window.GameSocial && window.GameSocial.client && window.GameSocial.client();
    if (!c) return Promise.resolve('');
    return c.auth.getSession().then(function (r) { return r.data && r.data.session ? r.data.session.access_token : ''; }, function () { return ''; });
  }
  function worker(path, body, signal) {
    return accessToken().then(function (at) {
      var h = {};
      var mt = null;
      try { mt = sessionStorage.getItem(MOD_TOKEN_KEY); } catch (e) { /* tab only */ }
      if (at) h.Authorization = 'Bearer ' + at;
      if (mt) h['X-Mod-Token'] = mt;
      if (body) h['Content-Type'] = 'application/json';
      return fetch(WORKER + path, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: signal });
    }).then(readResponse);
  }

  function readResponse(r) {
    return r.json().catch(function () { return {}; }).then(function (d) {
      if (!r.ok) { var e = new Error(d.error || 'The server answered ' + r.status); e.status = r.status; throw e; }
      return d;
    });
  }

  /* ---------- the shared site queue ---------- */

  var CONNECTION = { title: 'Server unreachable', detail: 'Check your connection.' };
  var QUEUED = ['queued', 'pending', 'requested', 'waiting'];
  var SITE_STEPS = ['Build', 'Publish', 'Verify'];

  function refreshSite() {
    if (document.hidden) return;
    if (navigator.onLine === false) { siteOffline(); return; }
    if (siteRequest) return;
    var request = new AbortController();
    siteRequest = request;
    var timeout = setTimeout(function () { request.abort(); }, 7000);
    fetch(WORKER + '/deploy/status', { cache: 'no-store', signal: request.signal }).then(readResponse).then(function (data) {
      if (!Array.isArray(data.runs)) throw new Error('Invalid deployment response.');
      if (navigator.onLine === false || siteRequest !== request) return;
      site = { data: data, error: null };
      if (siteEntries().some(function (e) { return ACTIVE[e.state]; })) showSiteUntil = now() + KEEP_DONE_MS;
    }).catch(function (err) {
      if (siteRequest !== request) return;
      site.error = !err.status ? CONNECTION : { title: 'Could not check deployments', detail: err.message };
    }).finally(function () {
      clearTimeout(timeout);
      if (siteRequest === request) siteRequest = null;
      render();
    });
  }

  function siteOffline() {
    if (siteRequest) { siteRequest.abort(); siteRequest = null; }
    site.error = CONNECTION;
    render();
  }

  function describeRun(run, current, verifying) {
    if (run.status === 'completed') {
      if (run.conclusion === 'success') {
        if (run.sha === current) return { state: 'live', title: 'Live', stage: 3 };
        if (verifying) return { state: 'checking', title: 'Verifying', stage: 2, detail: 'Waiting for kanaris-beans.com to serve this commit.' };
        return { state: 'past', title: 'Build completed' };
      }
      if (['skipped', 'cancelled', 'neutral'].indexOf(run.conclusion) >= 0) {
        return { state: 'past', title: run.conclusion === 'neutral' ? 'Closed' : run.conclusion === 'skipped' ? 'Skipped' : 'Cancelled' };
      }
      return { state: 'failed', title: 'Build failed' };
    }
    var jobs = run.jobs || [];
    var build = jobs.find(function (job) { return job.name === 'build'; });
    var publish = jobs.find(function (job) { return job.name === 'deploy'; });
    if (publish && publish.status === 'in_progress') return { state: 'building', title: 'Publishing', stage: 1, detail: publish.step };
    if (publish && publish.conclusion === 'success') return { state: 'checking', title: 'Finalising', stage: 2, detail: 'Waiting for GitHub to finish reporting the build.' };
    if (build && build.conclusion === 'success') return { state: 'building', title: 'Waiting to publish', stage: 1 };
    if (QUEUED.indexOf(run.status) >= 0 && (!build || build.status !== 'in_progress')) return { state: 'waiting', title: 'Queued', stage: 0 };
    return { state: 'building', title: 'Building', stage: 0, detail: build && build.step };
  }

  function siteEntries() {
    if (!site.data) return [];
    var data = site.data, runs = data.runs;
    var successIndex = runs.findIndex(function (run) { return run.status === 'completed' && run.conclusion === 'success'; });
    var liveIndex = runs.findIndex(function (run) { return run.sha === data.live; });
    var entries = runs.map(function (run, index) {
      // Pages can serve the new revision while GitHub still reports it as publishing.
      var verifying = index === successIndex && (liveIndex < 0 || index < liveIndex);
      var e = describeRun(run, data.live, verifying);
      e.id = 'pages-' + run.id;
      e.commit = run.sha;
      e.created = Date.parse(run.created) || 0;
      e.url = run.url;
      e.label = (run.message || '').split('\n')[0].slice(0, 150) || 'GitHub Pages';
      e.shared = true;
      e.kind = 'deploy';
      return e;
    });
    if (data.head && data.head !== data.live && !runs.some(function (run) { return run.sha === data.head; })) {
      entries.unshift({ id: 'pages-head', shared: true, kind: 'deploy', commit: data.head, label: 'GitHub Pages', state: 'waiting', title: 'Queued', stage: 0, detail: 'Waiting for GitHub to list this commit.' });
    }
    var active = entries.filter(function (e) { return ACTIVE[e.state]; });
    return active.concat(entries.filter(function (e) { return !ACTIVE[e.state]; }).slice(0, 5));
  }

  /* ---------- checking the live site ---------- */

  function blobSha(buf) {
    var bytes = new Uint8Array(buf);
    var head = new TextEncoder().encode('blob ' + bytes.length + '\0');
    var all = new Uint8Array(head.length + bytes.length);
    all.set(head); all.set(bytes, head.length);
    return crypto.subtle.digest('SHA-1', all).then(function (d) {
      return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  // Is this file being served exactly as committed? (A unique query string skips the site's own cache.)
  function served(f) {
    var url = location.origin + '/' + f.path.split('/').map(encodeURIComponent).join('/') + '?scd=' + now();
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (f.sha === null) return r.status === 404;
      if (!r.ok) return false;
      return r.arrayBuffer().then(blobSha).then(function (s) { return s === f.sha; });
    }, function () { return false; });
  }

  function step(e) {
    var paths = e.files.map(function (f) { return f.path; });
    return worker('/deploy?sha=' + e.commit + '&paths=' + encodeURIComponent(paths.join(','))).then(function (d) {
      // files a newer commit (any page, anyone) has changed again since: nothing of ours left to check there
      var ours = e.files.filter(function (f) { return !d.current || (d.current[f.path] || null) === (f.sha || null); });
      if (d.current && !ours.length) return finish(e.id, 'superseded', 'A newer change to the same files replaced this; that one is being deployed instead.');
      var run = d.run, latest = d.latest;
      if (run && run.status === 'completed' && run.conclusion === 'failure') return set(e.id, 'failed', 'The GitHub Pages build failed.', run.url);
      var laterBuild = latest && latest.sha !== e.commit && Date.parse(latest.created) >= e.created - 5000;
      var verifiedRun = run && run.status === 'completed' && run.conclusion === 'success' && d.live === e.commit;
      var verifiedLater = laterBuild && latest.status === 'completed' && latest.conclusion === 'success' && d.live === latest.sha;
      if (verifiedRun || verifiedLater || (!run && d.live === e.commit)) return verifyAll(e, ours, run || latest);
      if (run && run.status === 'completed' && run.conclusion === 'success') {
        return stallOr(e, 'checking', 'Build finished. Waiting for the new revision on kanaris-beans.com…', run.url);
      }
      var why = run
        ? (['queued', 'pending', 'waiting', 'requested'].indexOf(run.status) >= 0 ? 'Queued on GitHub Pages…' : run.status === 'completed' ? 'Waiting for a newer build…' : 'GitHub Pages is building the site…')
        : (latest && latest.status !== 'completed' ? 'Waiting for the build in front of it…' : 'Waiting for GitHub Pages to start…');
      return stallOr(e, 'building', why, (run || latest || {}).url);
    }, function (err) {
      if (err.status === 401 || err.status === 403) return change(e.id, function (x) { x.detail = 'Sign in as staff on a scuffed_dev page to keep checking.'; });
      return change(e.id, function (x) { x.detail = 'Couldn\'t check just now (' + err.message + '). Trying again…'; });
    });
  }

  // Every file of ours must be served exactly as committed (deleted ones gone) before it counts as live.
  function verifyAll(e, ours, run) {
    return Promise.all(ours.map(served)).then(function (ok) {
      var good = ok.filter(Boolean).length;
      if (good === ours.length) return finish(e.id, 'live', ours.length === 1 ? 'Live on kanaris-beans.com.' : 'All ' + ours.length + ' files live on kanaris-beans.com.');
      return stallOr(e, 'checking', 'Built. ' + good + ' of ' + ours.length + ' files live so far…', (run || {}).url);
    });
  }

  function stallOr(e, state, detail, url) {
    if (now() - e.created > STALL_MS) return set(e.id, 'stalled', 'Still not live after ' + Math.round(STALL_MS / 60000) + ' minutes. Re-deploy to build the site again.', url);
    return set(e.id, state, detail, url);
  }
  function set(id, state, detail, url) { return change(id, function (x) { x.state = state; x.detail = detail; if (url) x.url = url; }); }
  function finish(id, state, detail) {
    var e = change(id, function (x) { x.state = state; x.detail = detail; x.doneAt = now(); });
    if (e) pulse();
    return e;
  }

  // One tab at a time checks each commit; the others just show the shared result.
  function tick() {
    refreshSite();
    var l = list(), t = now(), dirty = false;
    // tidy: finished ones after a while, failed saves whose retry is gone (page reloaded) after 30 min
    var kept = l.filter(function (e) {
      if (e.doneAt && t - e.doneAt > KEEP_DONE_MS) return false;
      if (e.state === 'save-failed' && !retries[e.id] && t - e.created > 30 * 60000) return false;
      return true;
    });
    if (kept.length !== l.length) { l = kept; dirty = true; }
    var due = l.filter(function (e) {
      return !document.hidden && !site.error && ACTIVE[e.state] && t - (e.checkedAt || 0) >= POLL_MS && !(e.lockBy && e.lockBy !== tab && t - (e.lockAt || 0) < LOCK_MS);
    });
    due.forEach(function (e) { e.lockBy = tab; e.lockAt = t; e.checkedAt = t; dirty = true; });
    if (dirty) write(l); else render();
    due.forEach(function (e) {
      step(e).then(function () { change(e.id, function (x) { if (x.lockBy === tab) x.lockBy = null; }); }, function () {});
    });
  }

  /* ---------- what pages call ---------- */

  function watch(o) {
    if (!o || !/^[0-9a-f]{40}$/.test(String(o.commit || ''))) return;
    var files = (o.live || []).filter(function (f) { return f && f.path; }).slice(0, 40);
    if (!files.length) return;
    if (list().some(function (e) { return e.commit === o.commit; })) return;
    add({ id: 'd' + now().toString(36) + Math.random().toString(36).slice(2, 6), kind: 'deploy', label: o.label || 'Saved changes',
      page: document.title.split('·')[0].trim(), commit: o.commit, files: files, created: now(), state: 'waiting',
      detail: 'Saved. Waiting for GitHub Pages to start…' });
    pulse();
    setTimeout(tick, 1500);
  }

  function saveFailed(o) {
    var id = 'f' + now().toString(36) + Math.random().toString(36).slice(2, 6);
    if (typeof o.retry === 'function') retries[id] = o.retry;
    add({ id: id, kind: 'save', label: o.label || 'A save', page: document.title.split('·')[0].trim(), created: now(),
      state: 'save-failed', detail: String(o.error && o.error.message || o.error || 'It didn\'t save.') });
    expanded = true;
    render();
    return id;   // the page can clear it with dismiss(id) if it retries the save some other way
  }

  function redeploy(e) {
    if (cooldownLeft()) return;
    try { localStorage.setItem(COOLDOWN_KEY, String(now())); } catch (x) { /* fine */ }
    set(e.id, 'waiting', 'Asking GitHub Pages to build again…');
    worker('/redeploy', { sha: e.commit }).then(function (res) {
      change(e.id, function (x) { x.commit = res.commit; x.created = now(); x.checkedAt = 0; x.state = 'waiting'; x.detail = 'Re-deploy started. Waiting for GitHub Pages…'; x.redeploys = (x.redeploys || 0) + 1; });
    }, function (err) {
      set(e.id, 'stalled', 'Couldn\'t start a re-deploy: ' + err.message);
    });
  }

  function retry(e) {
    var fn = retries[e.id];
    if (!fn) return;
    remove(e.id);
    try { fn(); } catch (x) { saveFailed({ label: e.label, error: x, retry: fn }); }
  }

  /* ---------- the corner indicator ---------- */

  function ago(t) {
    var s = Math.max(0, (now() - t) / 1000);
    return s < 50 ? Math.round(s) + 's' : s < 3600 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h';
  }
  function el(tag, cls, text) { var x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; }
  function ico(d, size) { return '<svg width="' + (size || 16) + '" height="' + (size || 16) + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }
  var ICON = {
    rocket: 'M5 15c-1.5 1.5-2 4-2 6c2 0 4.5-.5 6-2M9 18l-3-3c1-3.5 3.8-8.2 9.6-10.6c1.4-.6 2.9-.9 4.4-.9c0 1.5-.3 3-.9 4.4C16.7 13.7 12 16.6 9 18zM15 9h.01',
    check: 'M5 12l5 5L20 7',
    alert: 'M12 8v5M12 16.5h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    x: 'M18 6L6 18M6 6l12 12'
  };

  var pulseTimer = 0;
  function pulse() {
    if (!ui) return;
    ui.root.classList.remove('is-pulse'); void ui.root.offsetWidth; ui.root.classList.add('is-pulse');
    clearTimeout(pulseTimer); pulseTimer = setTimeout(function () { ui.root.classList.remove('is-pulse'); }, 900);
  }

  function build() {
    if (headless || ui || !document.body) return;
    var root = el('div', 'scd-dep hidden');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Deploys to kanaris-beans.com');
    var pill = el('button', 'scd-dep-pill');
    pill.type = 'button';
    pill.setAttribute('aria-expanded', 'false');
    pill.innerHTML = '<span class="scd-dep-orb"><i class="scd-dep-ring"></i><span class="scd-dep-glyph"></span></span><span class="scd-dep-say"><strong></strong><small></small></span><span class="scd-dep-n"></span>';
    pill.addEventListener('click', function () { expanded = !expanded; render(); });
    var panel = el('div', 'scd-dep-panel');
    var head = el('div', 'scd-dep-head');
    head.innerHTML = '<span class="scd-dep-badge">' + ico(ICON.rocket, 14) + '</span><div><strong>Deploys</strong><small>to kanaris-beans.com</small></div>';
    var close = el('button', 'scd-dep-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Collapse');
    close.innerHTML = ico('M6 9l6 6l6-6', 16);
    close.addEventListener('click', function () { expanded = false; render(); });
    head.appendChild(close);
    var ol = el('ol', 'scd-dep-list');
    panel.appendChild(head);
    panel.appendChild(ol);
    root.appendChild(panel);
    root.appendChild(pill);
    document.body.appendChild(root);
    ui = { root: root, pill: pill, list: ol };
  }

  var STEPS = ['Saved', 'Building', 'Live'];
  function stepIndex(state) { return state === 'waiting' || state === 'building' ? 1 : state === 'checking' ? 2 : state === 'live' || state === 'superseded' ? 3 : 1; }

  function render() {
    var local = list(), entries = siteEntries();
    var state = JSON.stringify([local, site]);
    if (lastRender !== state) {
      lastRender = state;
      listeners.forEach(function (fn) { try { fn(local, site); } catch (e) { /* a listener's problem */ } });
    }
    build();
    if (!ui) return;

    var shared = entries.filter(function (e) { return ACTIVE[e.state]; });
    var localRows = local.slice().reverse().filter(function (e) {
      return !ACTIVE[e.state] || !shared.some(function (row) { return row.commit === e.commit; });
    });
    var rows = shared.concat(localRows);
    if (!shared.length && showSiteUntil > now()) {
      var result = entries[0];
      if (result && !localRows.some(function (e) { return e.commit === result.commit; })) rows.unshift(result);
    }
    if (!rows.length && !site.error) { expanded = false; lastPanel = ''; ui.root.className = 'scd-dep hidden'; return; }
    var bad = rows.filter(function (e) { return /failed|stalled/.test(e.state); });
    var active = rows.filter(function (e) { return ACTIVE[e.state]; });
    var verified = rows.some(function (e) { return e.state === 'live'; });
    var mood = site.error || bad.length ? 'bad' : active.length ? 'busy' : verified ? 'done' : 'idle';
    if (bad.length && !ui.root.classList.contains('is-bad')) expanded = true;
    var pulsing = ui.root.classList.contains('is-pulse');
    ui.root.className = 'scd-dep is-' + mood + (site.error ? ' is-unreachable' : '') + (expanded ? ' is-open' : '') + (pulsing ? ' is-pulse' : '');
    var say = ui.pill.querySelector('.scd-dep-say');
    say.querySelector('strong').textContent = site.error ? site.error.title : bad.length ? 'Needs attention' : active.length ? 'Deploying' : verified ? 'Live' : 'Deploys';
    say.querySelector('small').textContent = site.error ? site.error.detail : active.length ? active.length + (active.length === 1 ? ' active build' : ' active builds')
      : bad.length ? bad.length + (bad.length === 1 ? ' problem' : ' problems') + ' · tap to see' : verified ? 'Verified on kanaris-beans.com' : 'Recent activity';
    ui.pill.querySelector('.scd-dep-glyph').innerHTML = ico(site.error || bad.length ? ICON.alert : verified && !active.length ? ICON.check : ICON.rocket, 16);
    ui.pill.querySelector('.scd-dep-n').textContent = !site.error && active.length > 1 ? String(active.length) : '';
    ui.pill.setAttribute('aria-expanded', String(expanded));

    var panelState = JSON.stringify([rows, site.error, Math.ceil(cooldownLeft() / 1000)]);
    if (lastPanel === panelState) return;
    lastPanel = panelState;
    var ol = ui.list;
    var previousScroll = ol.scrollTop;
    ol.textContent = '';
    if (site.error) {
      var warning = el('li', 'scd-dep-item is-failed');
      warning.setAttribute('role', 'status');
      warning.appendChild(el('strong', 'scd-dep-warning', site.error.title));
      warning.appendChild(el('p', 'scd-dep-detail', site.error.detail + (rows.length ? ' Showing the last known status.' : '')));
      ol.appendChild(warning);
    }
    rows.forEach(function (e) {
      var li = el('li', 'scd-dep-item is-' + e.state);
      var top = el('div', 'scd-dep-top');
      top.appendChild(el('strong', null, e.label));
      if (e.created) {
        var when = el('time', null, ago(e.created));
        when.title = new Date(e.created).toLocaleString();
        top.appendChild(when);
      }
      li.appendChild(top);
      if (e.page) li.appendChild(el('span', 'scd-dep-page', e.page));
      if (e.kind === 'deploy' && (!e.shared || e.stage != null)) {
        var steps = el('ol', 'scd-dep-steps');
        var at = e.shared ? e.stage : stepIndex(e.state);
        (e.shared ? SITE_STEPS : STEPS).forEach(function (s, i) {
          var si = el('li', i < at ? 'is-done' : i === at ? 'is-on' : '', s);
          if (i === at && e.state === 'failed' || i === at && e.state === 'stalled') si.className = 'is-bad';
          steps.appendChild(si);
        });
        li.appendChild(steps);
      }
      li.appendChild(el('p', 'scd-dep-detail', [e.title, e.detail].filter(Boolean).join(' · ')));
      var acts = el('div', 'scd-dep-acts');
      if (e.state === 'save-failed') {
        if (retries[e.id]) {
          var rb = el('button', 'scd-dep-btn is-main', 'Retry save');
          rb.type = 'button';
          rb.addEventListener('click', function () { retry(e); });
          acts.appendChild(rb);
        } else acts.appendChild(el('span', 'scd-dep-note', 'Redo it on its page (the retry was lost when the page reloaded).'));
      }
      if (!e.shared && (e.state === 'failed' || e.state === 'stalled')) {
        var left = cooldownLeft();
        var dep = el('button', 'scd-dep-btn is-main', left ? 'Re-deploy in ' + Math.ceil(left / 1000) + 's' : 'Re-deploy');
        dep.type = 'button';
        dep.disabled = !!left;
        dep.title = 'Push an empty commit so GitHub Pages builds the site again (shared by every page; once every 2 minutes)';
        dep.addEventListener('click', function () { redeploy(e); });
        acts.appendChild(dep);
        var again = el('button', 'scd-dep-btn', 'Check again');
        again.type = 'button';
        again.addEventListener('click', function () { change(e.id, function (x) { x.state = 'checking'; x.created = now(); x.checkedAt = 0; x.detail = 'Checking again…'; }); tick(); });
        acts.appendChild(again);
      }
      if (e.url && e.kind === 'deploy') {
        var a = el('a', 'scd-dep-link', 'build');
        a.href = e.url; a.target = '_blank'; a.rel = 'noopener';
        acts.appendChild(a);
      }
      if (e.commit) {
        var c = el('a', 'scd-dep-link', e.commit.slice(0, 7));
        c.href = COMMIT_URL + e.commit; c.target = '_blank'; c.rel = 'noopener';
        c.title = 'Open the commit on GitHub';
        acts.appendChild(c);
      }
      if (!e.shared && !ACTIVE[e.state]) {
        var x = el('button', 'scd-dep-x');
        x.type = 'button';
        x.setAttribute('aria-label', 'Dismiss');
        x.innerHTML = ico(ICON.x, 13);
        x.addEventListener('click', function () { remove(e.id); });
        acts.appendChild(x);
      }
      li.appendChild(acts);
      ol.appendChild(li);
    });
    ol.scrollTop = previousScroll;
  }

  function boot() {
    build();
    render();
    setInterval(tick, TICK_MS);
    setTimeout(tick, 800);
    window.addEventListener('storage', function (ev) { if (ev.key === KEY || ev.key === COOLDOWN_KEY) render(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
    window.addEventListener('offline', siteOffline);
    window.addEventListener('online', refreshSite);
    if (navigator.onLine === false) siteOffline();
  }

  function byId(id) { return list().filter(function (x) { return x.id === id; })[0]; }
  window.ScuffedDeploy = {
    watch: watch, saveFailed: saveFailed, dismiss: remove, _tick: tick, _list: list,
    // for the app's Deploys screen
    list: list,
    status: function () { return site; },
    siteEntries: siteEntries,
    refresh: refreshSite,
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    redeploy: function (id) { var e = byId(id); if (e) redeploy(e); },
    retry: function (id) { var e = byId(id); if (e) retry(e); },
    canRetry: function (id) { return !!retries[id]; },
    checkAgain: function (id) { change(id, function (x) { x.state = 'checking'; x.created = now(); x.checkedAt = 0; x.detail = 'Checking again…'; }); tick(); },
    cooldownLeft: cooldownLeft
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
