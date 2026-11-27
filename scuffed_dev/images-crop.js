// scuffed_dev/images-crop.js: the "Crop & confirm" window for the world images page (/scuffed_dev/images/).
//
// Every upload or suggestion passes through here first: pick a shape (A4, square, 16:9, … or free), drag and
// resize the crop box, pick the Unity resolution (longest side 512 / 256 / 128 / 64 / 32), watch the live preview
// of the exact PNG that will be made, then confirm. Nothing is converted or sent until then.
//
//   ScuffedCrop.open({ files, prefs: { shape, size, pad }, replace: { path, w, h } | null,
//                      targetFor(file, i) -> "folder/name.png", confirmText })
//     -> Promise<{ items: [{ file, opts }], prefs }>   (items empty = cancelled)
//
// opts is what images.js's plan() understands: { crop: {x,y,w,h} in source px | null, ratio, size, pad, label }.
// The crop is in the picture's own pixels (as the browser shows it, EXIF rotation applied), so the background
// converter cuts exactly what you saw.
(function () {
  'use strict';

  var SHAPES = [
    { id: 'original', label: 'Original', ratio: null, tip: 'The whole picture, no crop' },
    { id: 'match', label: 'Match current', ratio: 'match', tip: 'Same shape as the picture you are replacing' },
    { id: 'a4p', label: 'A4 portrait', ratio: 1 / Math.SQRT2, tip: 'Poster, 210 × 297 (362 × 512 at 512)' },
    { id: 'a4l', label: 'A4 landscape', ratio: Math.SQRT2, tip: 'Poster on its side (512 × 362 at 512)' },
    { id: 'square', label: 'Square', ratio: 1, tip: 'Logos, profile pictures' },
    { id: 'w169', label: '16:9', ratio: 16 / 9, tip: 'Screens, banners' },
    { id: 't916', label: '9:16', ratio: 9 / 16, tip: 'Phone screenshots, tall banners' },
    { id: 'w43', label: '4:3', ratio: 4 / 3, tip: 'Photos' },
    { id: 'free', label: 'Free', ratio: 'free', tip: 'Any shape you drag' }
  ];
  var SIZES = [512, 256, 128, 64, 32];
  var MIN = 8;   // smallest crop, in source pixels

  var BY = {};
  SHAPES.forEach(function (s) { BY[s.id] = s; });

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  var st = null;   // the open session

  function ratio() {
    var s = BY[st.shape];
    if (!s) return null;
    if (s.ratio === 'match') return st.replace && st.replace.w && st.replace.h ? st.replace.w / st.replace.h : null;
    return s.ratio;
  }
  function locked() { var r = ratio(); return typeof r === 'number'; }
  function cropping() { return st.shape !== 'original' && !(st.pad && locked()); }

  function centered(r) {
    var W = st.W, H = st.H;
    if (W / H > r) { var w = H * r; return { x: (W - w) / 2, y: 0, w: w, h: H }; }
    var h = W / r; return { x: 0, y: (H - h) / 2, w: W, h: h };
  }

  function resetCrop() {
    var r = ratio();
    st.crop = typeof r === 'number' ? centered(r) : { x: 0, y: 0, w: st.W, h: st.H };
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

  /* ---------- drawing the window ---------- */

  function buildShapes() {
    var box = $('imCropShapes');
    box.textContent = '';
    SHAPES.forEach(function (s) {
      if (s.id === 'match' && !(st.replace && st.replace.w)) return;
      var b = el('button', 'im-crop-shape');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('data-shape', s.id);
      b.title = s.id === 'match' ? 'Same shape as ' + st.replace.path + ' (' + st.replace.w + '×' + st.replace.h + ')' : s.tip;
      var r = s.ratio === 'match' ? st.replace.w / st.replace.h : s.ratio;
      var ico = el('i', 'im-crop-ico' + (r === 'free' ? ' is-free' : r === null ? ' is-orig' : ''));
      if (typeof r === 'number') { ico.style.width = (r >= 1 ? 22 : Math.round(22 * r)) + 'px'; ico.style.height = (r >= 1 ? Math.round(22 / r) : 22) + 'px'; }
      b.appendChild(ico);
      b.appendChild(el('span', null, s.label));
      b.addEventListener('click', function () { setShape(s.id); });
      box.appendChild(b);
    });
  }

  function setShape(id) {
    st.shape = id;
    resetCrop();
    paint();
  }

  function imgRect() {
    var stage = $('imCropStage').getBoundingClientRect(), r = $('imCropImg').getBoundingClientRect();
    return { left: r.left - stage.left, top: r.top - stage.top, width: r.width, height: r.height, k: r.width / st.W };
  }

  function paint() {
    if (!st || !st.W) return;
    var R = imgRect();
    var box = $('imCropBox');
    var c = st.crop;
    box.style.left = (R.left + c.x * R.k) + 'px';
    box.style.top = (R.top + c.y * R.k) + 'px';
    box.style.width = (c.w * R.k) + 'px';
    box.style.height = (c.h * R.k) + 'px';
    box.classList.toggle('hidden', !cropping());
    box.classList.toggle('is-free', ratio() === 'free');
    $('imCropStage').classList.toggle('is-cropping', cropping());
    $('imCropSizeTag').textContent = Math.round(c.w) + ' × ' + Math.round(c.h);

    document.querySelectorAll('#imCropShapes [data-shape]').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-shape') === st.shape)); });
    var pad = $('imCropPad');
    pad.disabled = !locked();
    pad.checked = st.pad && locked();
    $('imCropPadRow').classList.toggle('is-off', !locked());
    $('imCropRes').value = String(st.size);

    var o = output();
    $('imCropOut').textContent = o.w + ' × ' + o.h + ' PNG';
    var bits = [BY[st.shape].label + (st.pad && locked() ? ', fitted' : '')];
    bits.push(st.replace ? 'replaces ' + st.replace.path : '→ ' + st.targets[st.i]);
    $('imCropOutSub').textContent = bits.join(' · ');
    $('imCropWarn').classList.toggle('hidden', !o.up);
    $('imCropWarn').textContent = o.up ? 'This part of the picture is smaller than ' + st.size + 'px, so it gets enlarged and may look soft. Pick a lower resolution or a bigger area.' : '';
    preview(o);
  }

  var previewQueued = false;
  function preview(o) {
    if (previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(function () {
      previewQueued = false;
      if (!st || !st.W) return;
      o = o || output();
      var cv = $('imCropPreview');
      var fit = Math.min(1, 200 / Math.max(o.w, o.h));
      cv.width = Math.max(1, Math.round(o.w * fit)); cv.height = Math.max(1, Math.round(o.h * fit));
      var g = cv.getContext('2d');
      g.clearRect(0, 0, cv.width, cv.height);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      var img = $('imCropImg');
      if (st.pad && locked()) {
        var s = Math.min(cv.width / st.W, cv.height / st.H), dw = st.W * s, dh = st.H * s;
        g.drawImage(img, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
      } else {
        var c = st.shape === 'original' ? { x: 0, y: 0, w: st.W, h: st.H } : st.crop;
        g.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, cv.width, cv.height);
      }
    });
  }

  /* ---------- dragging the box ---------- */

  var drag = null;
  function onDown(e) {
    if (!st || !cropping()) return;
    var h = e.target.getAttribute('data-h');
    if (!h && !e.target.closest('#imCropBox')) {
      // a press outside the box starts a fresh box there (free) or moves the box there (locked)
      var R0 = imgRect(), sx = (e.clientX - $('imCropStage').getBoundingClientRect().left - R0.left) / R0.k, sy = (e.clientY - $('imCropStage').getBoundingClientRect().top - R0.top) / R0.k;
      if (sx < 0 || sy < 0 || sx > st.W || sy > st.H) return;
      st.crop.x = clamp(sx - st.crop.w / 2, 0, st.W - st.crop.w);
      st.crop.y = clamp(sy - st.crop.h / 2, 0, st.H - st.crop.h);
      paint();
      h = 'move';
    }
    e.preventDefault();
    var R = imgRect();
    drag = { h: h || 'move', x0: e.clientX, y0: e.clientY, k: R.k, c: Object.assign({}, st.crop), id: e.pointerId };
    $('imCropStage').setPointerCapture(e.pointerId);
    $('imCropBox').classList.add('is-drag');
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
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
      // edge (free shape only)
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

  function onKey(e) {
    if (!st || !cropping() || !/^Arrow/.test(e.key) || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    var step = (e.shiftKey ? 0.1 : 0.01) * Math.max(st.W, st.H);
    var c = st.crop;
    if (e.key === 'ArrowLeft') c.x = clamp(c.x - step, 0, st.W - c.w);
    if (e.key === 'ArrowRight') c.x = clamp(c.x + step, 0, st.W - c.w);
    if (e.key === 'ArrowUp') c.y = clamp(c.y - step, 0, st.H - c.h);
    if (e.key === 'ArrowDown') c.y = clamp(c.y + step, 0, st.H - c.h);
    paint();
  }

  /* ---------- the queue of files ---------- */

  function loadFile() {
    var f = st.files[st.i];
    var n = st.files.length;
    $('imCropCount').textContent = n > 1 ? (st.i + 1) + ' of ' + n : '';
    $('imCropName').textContent = f.name;
    $('imCropName').title = f.name;
    $('imCropSrc').textContent = 'Reading…';
    $('imCropError').classList.add('hidden');
    $('imCropStage').classList.remove('is-error');
    $('imCropAllRow').classList.toggle('hidden', n - st.i < 2);
    $('imCropAllN').textContent = String(n - st.i - 1);
    $('imCropSkip').classList.toggle('hidden', n < 2);
    $('imCropOk').disabled = true;
    st.W = 0;
    if (st.url) URL.revokeObjectURL(st.url);
    st.url = URL.createObjectURL(f);
    var img = $('imCropImg');
    img.onload = function () {
      st.W = img.naturalWidth || 512; st.H = img.naturalHeight || 512;
      $('imCropSrc').textContent = st.W + ' × ' + st.H + ' · ' + (f.size >= 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB') + ' · ' + (f.type || 'image').replace('image/', '').toUpperCase();
      if (st.shape === 'match' && !(st.replace && st.replace.w)) st.shape = 'original';
      resetCrop();
      $('imCropOk').disabled = false;
      paint();
      $('imCropOk').focus();
    };
    img.onerror = function () {
      $('imCropSrc').textContent = '';
      $('imCropStage').classList.add('is-error');
      var ext = (/\.([a-z0-9]+)$/i.exec(f.name || '') || [])[1] || 'this';
      $('imCropError').textContent = 'This browser can\'t open .' + ext.toLowerCase() + ' files' +
        (/heic|heif/i.test(ext) ? ' (iPhone photos: use Safari, or save the photo as JPG first)' : /psd|tiff?|raw|cr2|nef|dng/i.test(ext) ? ' (export it as PNG or JPG first)' : '') + '. Skip it to carry on.';
      $('imCropError').classList.remove('hidden');
    };
    img.src = st.url;
  }

  function optsNow() {
    var r = ratio();
    var label = BY[st.shape].label + (st.pad && locked() ? ' (fitted)' : '') + ', ' + st.size + 'px';
    if (st.shape === 'original') return { crop: null, ratio: null, size: st.size, pad: false, label: label };
    if (st.pad && locked()) return { crop: null, ratio: r, size: st.size, pad: true, label: label };
    var c = st.crop;
    var x = Math.round(c.x), y = Math.round(c.y);
    return { crop: { x: x, y: y, w: Math.max(1, Math.min(st.W - x, Math.round(c.w))), h: Math.max(1, Math.min(st.H - y, Math.round(c.h))) }, ratio: typeof r === 'number' ? r : null, size: st.size, pad: false, label: label };
  }

  // The rest of the files get the same shape and size, centred (they haven't been looked at, so no crop box).
  function optsForRest() {
    var r = ratio();
    var label = BY[st.shape].label + (st.pad && locked() ? ' (fitted)' : '') + ', ' + st.size + 'px';
    return { crop: null, ratio: typeof r === 'number' ? r : null, size: st.size, pad: !!(st.pad && locked()), label: label };
  }

  function next() {
    st.i++;
    if (st.i >= st.files.length) return finish();
    loadFile();
  }

  function confirm() {
    if (!st || !st.W) return;
    st.items.push({ file: st.files[st.i], opts: optsNow() });
    if ($('imCropAll').checked && st.files.length - st.i > 1) {
      var o = optsForRest();
      for (var i = st.i + 1; i < st.files.length; i++) st.items.push({ file: st.files[i], opts: Object.assign({}, o) });
      return finish();
    }
    next();
  }

  function finish() {
    var s = st;
    st = null;
    if (s.url) URL.revokeObjectURL(s.url);
    var d = $('imCrop');
    if (d.open) { if (d.close) d.close(); else d.removeAttribute('open'); }
    s.resolve({ items: s.items, prefs: { shape: s.shape === 'match' ? s.prefShape : s.shape, size: s.size, pad: s.pad } });
  }

  function cancel() {
    if (!st) return;
    st.items = [];
    finish();
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
    $('imCropRes').addEventListener('change', function () { st.size = Number($('imCropRes').value) || 512; paint(); });
    $('imCropPad').addEventListener('change', function () { st.pad = $('imCropPad').checked; paint(); });
    $('imCropReset').addEventListener('click', function () { resetCrop(); paint(); });
    $('imCropOk').addEventListener('click', confirm);
    $('imCropSkip').addEventListener('click', next);
    $('imCropCancel').addEventListener('click', cancel);
    $('imCropClose').addEventListener('click', cancel);
    $('imCrop').addEventListener('cancel', function (e) { e.preventDefault(); cancel(); });
    window.addEventListener('resize', function () { if (st) paint(); });
    var sel = $('imCropRes');
    sel.textContent = '';
    SIZES.forEach(function (n) {
      var o = el('option', null, n + ' px' + (n === 512 ? ' (max)' : ''));
      o.value = String(n);
      sel.appendChild(o);
    });
  }

  function open(o) {
    wire();
    return new Promise(function (resolve) {
      var prefs = o.prefs || {};
      var shape = BY[prefs.shape] ? prefs.shape : 'original';
      st = {
        files: o.files, i: 0, items: [], resolve: resolve, replace: o.replace || null,
        targets: o.files.map(function (f, i) { return o.targetFor ? o.targetFor(f, i) : ''; }),
        shape: o.replace && o.replace.w ? 'match' : shape, prefShape: shape,
        size: SIZES.indexOf(Number(prefs.size)) >= 0 ? Number(prefs.size) : 512,
        pad: !!prefs.pad, crop: { x: 0, y: 0, w: 1, h: 1 }, W: 0, H: 0, url: null
      };
      buildShapes();
      $('imCropOk').textContent = o.confirmText || 'Confirm';
      $('imCropTitle').textContent = o.title || 'Crop & confirm';
      $('imCropAll').checked = false;
      var d = $('imCrop');
      if (d.showModal) d.showModal(); else d.setAttribute('open', '');
      loadFile();
    });
  }

  window.ScuffedCrop = { open: open, SHAPES: SHAPES, SIZES: SIZES, isOpen: function () { return !!st; } };
})();
