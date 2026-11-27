// scuffed_dev/images-crop.js: the "Crop & confirm" window for the world images page (/scuffed_dev/images/).
//
// Every upload, suggestion and re-crop passes through here first. The options bar along the top works like
// Photoshop's crop tool: a ratio preset menu (with a live ratio icon), editable W ⇄ H ratio fields (type your own
// ratio, swap them), Clear, the Unity size (longest side 512 / 256 / 128 / 64 / 32), a crop overlay (rule of
// thirds, grid, golden ratio, diagonal), "fit" (pad instead of crop), and reset / cancel / commit on the right.
// Photoshop's keys work too: Enter commits, Esc cancels, X swaps the ratio, O cycles the overlay, R resets.
//
// Up to MAX crop windows can be on the go at once: minimise one (–) and it waits as a tab in the dock in the
// bottom-left corner, crop box and all; click the tab to bring it back. Only one window is open at a time.
//
//   ScuffedCrop.open({ files, prefs: { shape, size, pad }, replace: { path, w, h } | null, startShape,
//                      targetFor(file, i) -> "folder/name.png", title, confirmText })
//     -> Promise<{ items: [{ file, opts }], prefs }>   (items empty = cancelled)
//   ScuffedCrop.count() / MAX / full() / flashDock()
//
// opts is what images.js's plan() understands: { crop: {x,y,w,h} in source px | null, ratio, size, pad, label }.
// The crop is in the picture's own pixels (as the browser shows it, EXIF rotation applied), so the background
// converter cuts exactly what you saw.
(function () {
  'use strict';

  // Ratio presets: [w, h] are what the W / H fields show (Photoshop-style ratio numbers).
  var SHAPES = [
    { id: 'original', label: 'Original ratio', short: 'Original' },
    { id: 'match', label: 'Match current image', short: 'Match current' },
    { id: 'a4p', label: 'A4 portrait (210 × 297)', short: 'A4 portrait', wh: [210, 297] },
    { id: 'a4l', label: 'A4 landscape (297 × 210)', short: 'A4 landscape', wh: [297, 210] },
    { id: 'square', label: '1 : 1 (Square)', short: 'Square', wh: [1, 1] },
    { id: 'w169', label: '16 : 9', short: '16:9', wh: [16, 9] },
    { id: 't916', label: '9 : 16', short: '9:16', wh: [9, 16] },
    { id: 'w43', label: '4 : 3', short: '4:3', wh: [4, 3] },
    { id: 't34', label: '3 : 4', short: '3:4', wh: [3, 4] },
    { id: 'free', label: 'Ratio (free)', short: 'Free' },
    { id: 'custom', label: 'Custom', short: 'Custom' }
  ];
  var SWAP = { a4p: 'a4l', a4l: 'a4p', w169: 't916', t916: 'w169', w43: 't34', t34: 'w43', square: 'square' };
  var OVERLAYS = [['thirds', 'Rule of thirds'], ['grid', 'Grid'], ['golden', 'Golden ratio'], ['diagonal', 'Diagonal'], ['none', 'No overlay']];
  var SIZES = [512, 256, 128, 64, 32];
  var MAX = 3;     // crop windows on the go at once (open + minimised)
  var MIN = 8;     // smallest crop, in source pixels
  var OVERLAY_KEY = 'scd-images-crop-overlay';

  var BY = {};
  SHAPES.forEach(function (s) { BY[s.id] = s; });

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function num(v) { var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) && n > 0 ? n : 0; }
  function trim(n) { return String(Math.round(n * 1000) / 1000); }

  var sessions = [];   // every crop window on the go, oldest first
  var st = null;       // the one that's open (null = all minimised)
  var nextId = 0;
  var overlay = 'thirds';
  try { var ov = localStorage.getItem(OVERLAY_KEY); if (ov) overlay = ov; } catch (e) { /* private mode */ }

  /* ---------- ratio maths ---------- */

  function wh() {
    var s = st.shape;
    if (s === 'original') return st.W ? [st.W, st.H] : null;
    if (s === 'match') return st.replace && st.replace.w ? [st.replace.w, st.replace.h] : null;
    if (s === 'custom') return st.custom;
    return BY[s] && BY[s].wh ? BY[s].wh : null;
  }
  function ratio() {
    if (st.shape === 'free') return 'free';
    if (st.shape === 'original') return null;
    var p = wh();
    return p ? p[0] / p[1] : null;
  }
  function locked() { return typeof ratio() === 'number'; }
  function cropping() { return st.shape !== 'original' && !(st.pad && locked()); }
  function shapeLabel(s) {
    s = s || st;
    if (s.shape === 'custom') return 'Custom ' + trim(s.custom[0]) + ':' + trim(s.custom[1]);
    return BY[s.shape].short;
  }

  function centered(r) {
    var W = st.W, H = st.H;
    if (W / H > r) { var w = H * r; return { x: (W - w) / 2, y: 0, w: w, h: H }; }
    var h = W / r; return { x: 0, y: (H - h) / 2, w: W, h: h };
  }

  function resetCrop() {
    var r = ratio();
    st.crop = typeof r === 'number' ? centered(r) : { x: 0, y: 0, w: st.W, h: st.H };
  }

  // New ratio, Photoshop-style: keep the box's centre and roughly its area, then fit it inside the picture.
  function reshape(r) {
    if (typeof r !== 'number') return;
    var c = st.crop, cx = c.x + c.w / 2, cy = c.y + c.h / 2, area = Math.max(c.w * c.h, MIN * MIN);
    var w = Math.sqrt(area * r), h = w / r;
    var k = Math.min(1, st.W / w, st.H / h);
    w *= k; h *= k;
    st.crop = { x: clamp(cx - w / 2, 0, st.W - w), y: clamp(cy - h / 2, 0, st.H - h), w: w, h: h };
  }

  // The PNG this will make: { w, h, up } (up = it gets enlarged, so it may look soft).
  function output() {
    var N = st.size, r = ratio();
    if (st.pad && typeof r === 'number') {
      var W = r >= 1 ? N : Math.max(1, Math.round(N * r)), H = r >= 1 ? Math.max(1, Math.round(N / r)) : N;
      return { w: W, h: H, up: Math.max(W / st.W, H / st.H) > 1.01 && Math.min(W / st.W, H / st.H) > 1.01 };
    }
    var c = st.shape === 'original' ? { w: st.W, h: st.H } : st.crop;
    var k = N / Math.max(c.w, c.h);
    return { w: Math.max(1, Math.round(c.w * k)), h: Math.max(1, Math.round(c.h * k)), up: k > 1.01 };
  }

  /* ---------- the options bar ---------- */

  function buildRatioMenu() {
    var sel = $('imCropRatio');
    sel.textContent = '';
    SHAPES.forEach(function (s) {
      if (s.id === 'match' && !(st.replace && st.replace.w)) return;
      if (s.id === 'custom' && st.shape !== 'custom') return;
      var o = el('option', null, s.id === 'match' ? 'Match current (' + st.replace.w + ' × ' + st.replace.h + ')' : s.id === 'custom' ? 'Custom (' + trim(st.custom[0]) + ' : ' + trim(st.custom[1]) + ')' : s.label);
      o.value = s.id;
      sel.appendChild(o);
    });
    sel.value = st.shape;
  }

  function setShape(id, keepBox) {
    st.shape = id;
    if (keepBox && locked()) reshape(ratio()); else if (!keepBox) resetCrop();
    buildRatioMenu();
    paint(true);
  }

  function typedRatio() {
    var w = num($('imCropW').value), h = num($('imCropH').value);
    if (!w || !h) return;
    var p = wh();
    if (p && Math.abs(p[0] - w) < 1e-6 && Math.abs(p[1] - h) < 1e-6) return;
    st.custom = [w, h];
    setShape('custom', true);
  }

  function swap() {
    if (!st || !st.W) return;
    if (st.shape === 'free') {
      var c = st.crop, cx = c.x + c.w / 2, cy = c.y + c.h / 2, w = Math.min(c.h, st.W), h = Math.min(c.w, st.H);
      st.crop = { x: clamp(cx - w / 2, 0, st.W - w), y: clamp(cy - h / 2, 0, st.H - h), w: w, h: h };
      return paint(true);
    }
    if (SWAP[st.shape]) return setShape(SWAP[st.shape], true);
    var p = wh();
    if (!p) return;
    st.custom = [p[1], p[0]];
    setShape('custom', true);
  }

  function clear() {
    // Photoshop's Clear: forget the ratio, keep the box where it is
    if (!st || !st.W) return;
    if (st.shape === 'original') resetCrop();
    st.shape = 'free';
    st.pad = false;
    buildRatioMenu();
    paint(true);
  }

  function setOverlay(v) {
    overlay = v;
    try { localStorage.setItem(OVERLAY_KEY, v); } catch (e) { /* fine */ }
    $('imCropOverlay').value = v;
    $('imCropGrid').className = 'im-crop-grid ov-' + v;
  }

  // The little rectangle before the ratio menu takes the current ratio's shape (dashed when free).
  function ratioIcon() {
    var i = $('imCropRatioIco').firstChild, r = ratio(), S = 16;
    if (st.shape === 'original' && st.W) r = st.W / st.H;
    var w = typeof r === 'number' ? (r >= 1 ? S : Math.max(5, Math.round(S * r))) : 15;
    var h = typeof r === 'number' ? (r >= 1 ? Math.max(5, Math.round(S / r)) : S) : 11;
    i.style.width = w + 'px';
    i.style.height = h + 'px';
    $('imCropRatioIco').classList.toggle('is-free', r === 'free');
    $('imCropRatioIco').title = 'Current ratio: ' + shapeLabel();
  }

  /* ---------- drawing ---------- */

  // Where the picture sits in the stage, in layout pixels. offset* rather than getBoundingClientRect: the window's
  // open animation scales it for a moment, and screen rects taken then put the box a few pixels off.
  function imgRect() {
    var img = $('imCropImg');
    return { left: img.offsetLeft, top: img.offsetTop, width: img.offsetWidth, height: img.offsetHeight, k: img.offsetWidth / st.W };
  }

  // animate = ease the box to its new place (ratio changes); dragging and resizing stay instant
  function paint(animate) {
    if (!st || !st.W) return;
    var R = imgRect();
    var box = $('imCropBox');
    var c = st.crop;
    box.classList.toggle('is-ease', !!animate);
    box.style.left = (R.left + c.x * R.k) + 'px';
    box.style.top = (R.top + c.y * R.k) + 'px';
    box.style.width = (c.w * R.k) + 'px';
    box.style.height = (c.h * R.k) + 'px';
    box.classList.toggle('hidden', !cropping());
    box.classList.toggle('is-free', ratio() === 'free');
    $('imCropStage').classList.toggle('is-cropping', cropping());
    $('imCropSizeTag').textContent = Math.round(c.w) + ' × ' + Math.round(c.h) + ' px';

    // options bar
    $('imCropRatio').value = st.shape;
    var p = wh();
    var wIn = $('imCropW'), hIn = $('imCropH');
    if (document.activeElement !== wIn) wIn.value = p ? trim(p[0]) : '';
    if (document.activeElement !== hIn) hIn.value = p ? trim(p[1]) : '';
    wIn.placeholder = hIn.placeholder = st.shape === 'free' ? 'free' : '';
    var pad = $('imCropPad');
    pad.disabled = !locked();
    pad.checked = st.pad && locked();
    $('imCropPadRow').classList.toggle('is-off', !locked());
    $('imCropPadRow').title = locked() ? 'Keep the whole picture and pad it to this ratio (transparent edges)' : 'Pick a ratio first';
    $('imCropRes').value = String(st.size);
    $('imCropOverlay').disabled = !cropping();
    ratioIcon();

    // result
    var o = output();
    $('imCropOut').textContent = o.w + ' × ' + o.h;
    $('imCropOutShape').textContent = shapeLabel() + (st.pad && locked() ? ', fitted' : '');
    $('imCropOutSub').textContent = st.replace ? 'Replaces ' + st.replace.path : 'Saved as ' + st.targets[st.i];
    $('imCropWarn').classList.toggle('hidden', !o.up);
    $('imCropWarn').textContent = o.up ? 'This part is smaller than ' + st.size + 'px, so it gets enlarged and may look soft. Pick a lower size or a bigger area.' : '';
    preview();
  }

  var previewQueued = false;
  function preview() {
    if (previewQueued) return;
    previewQueued = true;
    // a timer, not requestAnimationFrame: rAF stops in background tabs, which left stale previews
    setTimeout(function () {
      previewQueued = false;
      if (!st || !st.W) return;
      var o = output();   // always the latest: several paints can land in one frame
      var img = $('imCropImg');
      // 1. the PNG exactly as it will be made, at its real size (so 64px really looks like 64px)
      var real = document.createElement('canvas');
      real.width = o.w; real.height = o.h;
      var rg = real.getContext('2d');
      rg.imageSmoothingEnabled = true; rg.imageSmoothingQuality = 'high';
      if (st.pad && locked()) {
        var s = Math.min(o.w / st.W, o.h / st.H), dw = st.W * s, dh = st.H * s;
        rg.drawImage(img, (o.w - dw) / 2, (o.h - dh) / 2, dw, dh);
      } else {
        var c = st.shape === 'original' ? { x: 0, y: 0, w: st.W, h: st.H } : st.crop;
        rg.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, o.w, o.h);
      }
      // 2. the whole of it fitted into the square preview box (never cropped), crisp on high-DPI screens
      var cv = $('imCropPreview'), box = cv.parentNode;
      var room = Math.max(40, Math.min(box.clientWidth, box.clientHeight || box.clientWidth) - 24);
      var k = Math.min(room / o.w, room / o.h);
      var cssW = Math.max(1, Math.round(o.w * k)), cssH = Math.max(1, Math.round(o.h * k));
      var dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
      cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
      var g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
      g.imageSmoothingEnabled = k * dpr < 1;   // shrinking: smooth; enlarging a small PNG: show its real pixels
      g.imageSmoothingQuality = 'high';
      g.drawImage(real, 0, 0, cv.width, cv.height);
    }, 16);
  }

  /* ---------- dragging the box ---------- */

  var drag = null;
  function onDown(e) {
    if (!st || !st.W || !cropping()) return;
    var h = e.target.getAttribute && e.target.getAttribute('data-h');
    if (!h && !e.target.closest('#imCropBox')) {
      // a press outside the box moves the box there
      var S0 = $('imCropStage').getBoundingClientRect(), R0 = imgRect();
      var sx = (e.clientX - S0.left - R0.left) / R0.k, sy = (e.clientY - S0.top - R0.top) / R0.k;
      if (sx < 0 || sy < 0 || sx > st.W || sy > st.H) return;
      st.crop.x = clamp(sx - st.crop.w / 2, 0, st.W - st.crop.w);
      st.crop.y = clamp(sy - st.crop.h / 2, 0, st.H - st.crop.h);
      paint();
    }
    e.preventDefault();
    $('imCropStage').focus({ preventScroll: true });
    var R = imgRect();
    drag = { h: h || 'move', x0: e.clientX, y0: e.clientY, k: R.k, c: Object.assign({}, st.crop), id: e.pointerId };
    $('imCropStage').setPointerCapture(e.pointerId);
    $('imCropBox').classList.add('is-drag');
  }

  function onMove(e) {
    if (!drag || !st || e.pointerId !== drag.id) return;
    var dx = (e.clientX - drag.x0) / drag.k, dy = (e.clientY - drag.y0) / drag.k;
    var c0 = drag.c, W = st.W, H = st.H, r = ratio(), c = st.crop;
    if (drag.h === 'move') {
      c.x = clamp(c0.x + dx, 0, W - c0.w);
      c.y = clamp(c0.y + dy, 0, H - c0.h);
    } else if (drag.h.length === 2) {
      // corner: the opposite corner stays put
      var sx = drag.h.indexOf('e') >= 0 ? 1 : -1, sy = drag.h.indexOf('s') >= 0 ? 1 : -1;
      var ax = sx > 0 ? c0.x : c0.x + c0.w, ay = sy > 0 ? c0.y : c0.y + c0.h;
      var maxW = sx > 0 ? W - ax : ax, maxH = sy > 0 ? H - ay : ay;
      var w = clamp(sx * ((sx > 0 ? c0.x + c0.w : c0.x) + dx - ax), MIN, maxW);
      var h = clamp(sy * ((sy > 0 ? c0.y + c0.h : c0.y) + dy - ay), MIN, maxH);
      if (typeof r === 'number') {
        if (w / r > h) h = w / r; else w = h * r;
        if (w > maxW) { w = maxW; h = w / r; }
        if (h > maxH) { h = maxH; w = h * r; }
      }
      c.w = w; c.h = h;
      c.x = sx > 0 ? ax : ax - w;
      c.y = sy > 0 ? ay : ay - h;
    } else {
      // edge (free ratio only)
      if (drag.h === 'e') c.w = clamp(c0.w + dx, MIN, W - c0.x);
      if (drag.h === 's') c.h = clamp(c0.h + dy, MIN, H - c0.y);
      if (drag.h === 'w') { var nx = clamp(c0.x + dx, 0, c0.x + c0.w - MIN); c.w = c0.x + c0.w - nx; c.x = nx; }
      if (drag.h === 'n') { var ny = clamp(c0.y + dy, 0, c0.y + c0.h - MIN); c.h = c0.y + c0.h - ny; c.y = ny; }
    }
    paint();
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    $('imCropBox').classList.remove('is-drag');
  }

  // Photoshop keys. Arrow keys nudge the box (Shift = 10x).
  function onKey(e) {
    if (!st) return;
    var t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
    if (e.key === 'Enter') {
      if (t && t.tagName === 'INPUT' && t.type !== 'checkbox') { e.preventDefault(); typedRatio(); t.blur(); return; }
      if (t && t.tagName === 'BUTTON') return;
      e.preventDefault(); confirm(); return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (k === 'x') { e.preventDefault(); swap(); return; }
    if (k === 'o') { e.preventDefault(); var i = OVERLAYS.map(function (o) { return o[0]; }).indexOf(overlay); setOverlay(OVERLAYS[(i + 1) % OVERLAYS.length][0]); flashOverlay(); return; }
    if (k === 'r') { e.preventDefault(); resetCrop(); paint(true); return; }
    if (!cropping() || !/^Arrow/.test(e.key)) return;
    e.preventDefault();
    var step = (e.shiftKey ? 0.1 : 0.01) * Math.max(st.W, st.H);
    var c = st.crop;
    if (e.key === 'ArrowLeft') c.x = clamp(c.x - step, 0, st.W - c.w);
    if (e.key === 'ArrowRight') c.x = clamp(c.x + step, 0, st.W - c.w);
    if (e.key === 'ArrowUp') c.y = clamp(c.y - step, 0, st.H - c.h);
    if (e.key === 'ArrowDown') c.y = clamp(c.y + step, 0, st.H - c.h);
    paint();
  }

  var flashTimer = 0;
  function flashOverlay() {
    var b = $('imCropBox');
    b.classList.add('is-flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { b.classList.remove('is-flash'); }, 900);
  }

  /* ---------- showing a session in the window ---------- */

  function chrome() {
    var n = st.files.length;
    $('imCropTitle').textContent = st.title;
    $('imCropOk').textContent = st.confirmText;
    $('imCropCommit').title = st.confirmText + ' (Enter)';
    $('imCropCount').textContent = n > 1 ? (st.i + 1) + ' of ' + n : '';
    $('imCropAllRow').classList.toggle('hidden', n - st.i < 2);
    $('imCropAllN').textContent = String(n - st.i - 1);
    $('imCropAll').checked = !!st.all;
    $('imCropSkip').classList.toggle('hidden', n < 2);
    var others = sessions.length - 1;
    $('imCropMin').title = 'Minimise to the dock (bottom left)' + (others ? ' · ' + others + ' other crop' + (others === 1 ? '' : 's') + ' waiting there' : '');
  }

  // keepCrop: coming back from the dock (keep the box where it was) rather than a fresh file
  function showImage(keepCrop) {
    var s = st, f = s.files[s.i];
    chrome();
    $('imCropName').textContent = f.name;
    $('imCropName').title = f.name;
    $('imCropSrc').textContent = 'Reading…';
    $('imCropError').classList.add('hidden');
    var stage = $('imCropStage');
    stage.classList.remove('is-error');
    stage.classList.add('is-loading');
    $('imCropBox').classList.add('hidden');
    $('imCropOk').disabled = $('imCropCommit').disabled = true;
    if (!keepCrop || !s.url) { if (s.url) URL.revokeObjectURL(s.url); s.url = URL.createObjectURL(f); s.ready = false; }
    var img = $('imCropImg');
    img.onload = function () {
      if (st !== s) return;
      s.W = img.naturalWidth || 512; s.H = img.naturalHeight || 512;
      $('imCropSrc').textContent = s.W + ' × ' + s.H + ' · ' + (f.size >= 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB') + ' · ' + (f.type || 'image').replace('image/', '').toUpperCase();
      if (s.shape === 'match' && !(s.replace && s.replace.w)) s.shape = 'original';
      if (!s.ready) resetCrop();
      s.ready = true;
      stage.classList.remove('is-loading');
      buildRatioMenu();
      $('imCropOk').disabled = $('imCropCommit').disabled = false;
      paint();
      stage.focus({ preventScroll: true });
    };
    img.onerror = function () {
      if (st !== s) return;
      $('imCropSrc').textContent = '';
      stage.classList.remove('is-loading');
      stage.classList.add('is-error');
      var ext = (/\.([a-z0-9]+)$/i.exec(f.name || '') || [])[1] || 'this';
      $('imCropError').textContent = 'This browser can\'t open .' + ext.toLowerCase() + ' files' +
        (/heic|heif/i.test(ext) ? ' (iPhone photos: use Safari, or save the photo as JPG first)' : /psd|tiff?|raw|cr2|nef|dng/i.test(ext) ? ' (export it as PNG or JPG first)' : '') + '.' + (s.files.length > 1 ? ' Skip it to carry on.' : '');
      $('imCropError').classList.remove('hidden');
    };
    s.W = 0;
    img.src = s.url;
  }

  function openWindow() {
    var d = $('imCrop');
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  }
  function closeWindow() {
    var d = $('imCrop');
    if (d.open) { if (d.close) d.close(); else d.removeAttribute('open'); }
  }

  /* ---------- the dock: minimised crops wait in the bottom-left corner ---------- */

  function minimise() {
    if (!st) return;
    var s = st;
    try { s.thumb = $('imCropPreview').toDataURL('image/png'); } catch (e) { s.thumb = null; }
    s.outText = $('imCropOut').textContent;
    s.min = true;
    st = null;
    drag = null;
    closeWindow();
    renderDock();
    var tab = document.querySelector('[data-crop="' + s.id + '"]');
    if (tab) { tab.classList.add('is-new'); setTimeout(function () { tab.classList.remove('is-new'); }, 700); }
  }

  function restore(s) {
    if (!s || st === s) return;
    if (st) minimise();
    s.min = false;
    st = s;
    renderDock();
    openWindow();
    showImage(true);
  }

  function renderDock() {
    var dock = $('imCropDock'), tabs = $('imCropDockTabs');
    var waiting = sessions.filter(function (s) { return s.min; });
    dock.classList.toggle('hidden', !waiting.length);
    $('imCropDockN').textContent = sessions.length + '/' + MAX;
    tabs.textContent = '';
    waiting.forEach(function (s) {
      var tab = el('div', 'im-dock-tab');
      tab.setAttribute('data-crop', String(s.id));
      var go = el('button', 'im-dock-go');
      go.type = 'button';
      go.title = 'Bring back: ' + s.title;
      var th = el('span', 'im-dock-thumb im-checker');
      if (s.thumb) { var i = el('img'); i.src = s.thumb; i.alt = ''; th.appendChild(i); }
      go.appendChild(th);
      var txt = el('span', 'im-dock-text');
      txt.appendChild(el('strong', null, s.files[s.i] ? s.files[s.i].name : 'Crop'));
      txt.appendChild(el('span', null, (s.outText || '') + ' · ' + shapeLabel(s) + (s.files.length > 1 ? ' · ' + (s.i + 1) + '/' + s.files.length : '')));
      go.appendChild(txt);
      go.addEventListener('click', function () { restore(s); });
      tab.appendChild(go);
      var x = el('button', 'im-dock-x');
      x.type = 'button';
      x.title = 'Cancel this crop';
      x.setAttribute('aria-label', 'Cancel the crop of ' + (s.files[s.i] ? s.files[s.i].name : 'this picture'));
      x.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
      x.addEventListener('click', function () { s.items = []; finishSession(s); });
      tab.appendChild(x);
      tabs.appendChild(tab);
    });
  }

  function flashDock() {
    var dock = $('imCropDock');
    if (dock.classList.contains('hidden')) return;
    dock.classList.remove('is-flash');
    void dock.offsetWidth;
    dock.classList.add('is-flash');
  }

  /* ---------- the queue of files ---------- */

  function label() { return shapeLabel() + (st.pad && locked() ? ' (fitted)' : '') + ', ' + st.size + 'px'; }

  function optsNow() {
    var r = ratio();
    if (st.shape === 'original') return { crop: null, ratio: null, size: st.size, pad: false, label: label() };
    if (st.pad && locked()) return { crop: null, ratio: r, size: st.size, pad: true, label: label() };
    var c = st.crop;
    var x = Math.round(c.x), y = Math.round(c.y);
    return { crop: { x: x, y: y, w: Math.max(1, Math.min(st.W - x, Math.round(c.w))), h: Math.max(1, Math.min(st.H - y, Math.round(c.h))) }, ratio: typeof r === 'number' ? r : null, size: st.size, pad: false, label: label() };
  }

  // The rest of the files get the same ratio and size, centred (they haven't been looked at, so no crop box).
  function optsForRest() {
    var r = ratio();
    return { crop: null, ratio: typeof r === 'number' ? r : null, size: st.size, pad: !!(st.pad && locked()), label: label() };
  }

  function next() {
    if (!st) return;
    st.i++;
    if (st.i >= st.files.length) return finishSession(st);
    showImage(false);
  }

  function confirm() {
    if (!st || !st.W) return;
    st.items.push({ file: st.files[st.i], opts: optsNow() });
    if ($('imCropAll').checked && st.files.length - st.i > 1) {
      var o = optsForRest();
      for (var i = st.i + 1; i < st.files.length; i++) st.items.push({ file: st.files[i], opts: Object.assign({}, o) });
      return finishSession(st);
    }
    next();
  }

  function finishSession(s) {
    sessions = sessions.filter(function (x) { return x !== s; });
    if (s.url) URL.revokeObjectURL(s.url);
    s.url = null;
    if (st === s) { st = null; drag = null; closeWindow(); }
    renderDock();
    var keep = /^(match|custom)$/.test(s.shape) || s.recrop ? s.prefShape : s.shape;
    s.resolve({ items: s.items, prefs: { shape: keep, size: s.size, pad: s.pad } });
  }

  function cancel() {
    if (!st) return;
    st.items = [];
    finishSession(st);
  }

  var wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    var stage = $('imCropStage');
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    $('imCrop').addEventListener('keydown', onKey);
    $('imCropRatio').addEventListener('change', function () { setShape($('imCropRatio').value, false); });
    $('imCropW').addEventListener('change', typedRatio);
    $('imCropH').addEventListener('change', typedRatio);
    $('imCropSwap').addEventListener('click', swap);
    $('imCropClear').addEventListener('click', clear);
    $('imCropRes').addEventListener('change', function () { st.size = Number($('imCropRes').value) || 512; paint(); });
    $('imCropPad').addEventListener('change', function () { st.pad = $('imCropPad').checked; paint(true); });
    $('imCropOverlay').addEventListener('change', function () { setOverlay($('imCropOverlay').value); flashOverlay(); });
    $('imCropReset').addEventListener('click', function () { resetCrop(); paint(true); });
    $('imCropAll').addEventListener('change', function () { if (st) st.all = $('imCropAll').checked; });
    $('imCropOk').addEventListener('click', confirm);
    $('imCropCommit').addEventListener('click', confirm);
    $('imCropSkip').addEventListener('click', next);
    $('imCropCancel').addEventListener('click', cancel);
    $('imCropAbort').addEventListener('click', cancel);
    $('imCropClose').addEventListener('click', cancel);
    $('imCropMin').addEventListener('click', minimise);
    $('imCrop').addEventListener('cancel', function (e) { e.preventDefault(); cancel(); });
    $('imCropBox').addEventListener('transitionend', function () { $('imCropBox').classList.remove('is-ease'); });
    window.addEventListener('resize', function () { if (st) paint(); });
    var sel = $('imCropRes');
    sel.textContent = '';
    SIZES.forEach(function (n) {
      var o = el('option', null, n + ' px' + (n === 512 ? ' (max)' : ''));
      o.value = String(n);
      sel.appendChild(o);
    });
    var ov = $('imCropOverlay');
    ov.textContent = '';
    OVERLAYS.forEach(function (o) { var x = el('option', null, o[1]); x.value = o[0]; ov.appendChild(x); });
    setOverlay(OVERLAYS.some(function (o) { return o[0] === overlay; }) ? overlay : 'thirds');
  }

  function open(o) {
    wire();
    return new Promise(function (resolve) {
      if (sessions.length >= MAX) { flashDock(); resolve({ items: [], prefs: o.prefs || {}, full: true }); return; }
      if (st) minimise();   // the open one goes to the dock; the new one takes the window
      var prefs = o.prefs || {};
      var shape = BY[prefs.shape] && !/^(match|custom)$/.test(prefs.shape) ? prefs.shape : 'original';
      var s = {
        id: ++nextId, files: o.files, i: 0, items: [], resolve: resolve, replace: o.replace || null, recrop: !!o.startShape,
        targets: o.files.map(function (f, i) { return o.targetFor ? o.targetFor(f, i) : ''; }),
        shape: o.startShape || (o.replace && o.replace.w ? 'match' : shape), prefShape: shape, custom: [1, 1],
        size: SIZES.indexOf(Number(prefs.size)) >= 0 ? Number(prefs.size) : 512,
        pad: !!prefs.pad, crop: { x: 0, y: 0, w: 1, h: 1 }, W: 0, H: 0, url: null, ready: false,
        title: o.title || 'Crop & confirm', confirmText: o.confirmText || 'Confirm', all: false, min: false
      };
      sessions.push(s);
      st = s;
      renderDock();
      openWindow();
      showImage(false);
    });
  }

  window.ScuffedCrop = {
    open: open, SIZES: SIZES, MAX: MAX,
    count: function () { return sessions.length; },
    full: function () { return sessions.length >= MAX; },
    isOpen: function () { return !!st; },
    flashDock: flashDock,
    restore: function () { var s = sessions.filter(function (x) { return x.min; })[0]; if (s && !st) restore(s); }
  };
})();
