// scuffed_dev/get-app.js: the "Get the app" card on the scuffed_dev hub (/scuffed_dev/).
//   Android: the APK from GitHub Releases. iOS: the web app (Safari › Share › Add to Home Screen) for now.
//   Then "Show sign-in QR": a one-time code from this browser's account (link_code_create, 10 minutes,
//   supabase/migrations/2026-10-11-device-links.sql) as an Android App Link.
//   The app's "Scan sign-in QR" redeems it, and the phone acts as this account from then on.
(function () {
  'use strict';

  var APP_URL = 'https://kanaris-beans.com/scuffed_dev/app/';
  var QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function isIos() { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }

  var platform = isIos() ? 'ios' : 'android';
  var qrLib = null, timer = 0, qrColEl = null;

  function loadQr() {
    if (window.QRCode) return Promise.resolve();
    qrLib = qrLib || new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = QR_LIB; s.onload = res;
      s.onerror = function () { qrLib = null; rej(new Error('Couldn\'t load the QR code maker.')); };
      document.head.appendChild(s);
    });
    return qrLib;
  }
  function label() {
    var ua = navigator.userAgent || '';
    return /Windows/.test(ua) ? 'Windows PC' : /Macintosh/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /iPhone/.test(ua) ? 'iPhone' : 'Browser';
  }
  function step(n, title, body) {
    var li = el('li', 'ga-step');
    li.appendChild(el('span', 'ga-n', String(n)));
    var t = el('div', 'ga-step-text');
    t.appendChild(el('strong', null, title));
    if (body) (Array.isArray(body) ? body : [body]).forEach(function (b) { t.appendChild(typeof b === 'string' ? el('span', null, b) : b); });
    li.appendChild(t);
    return li;
  }

  function render() {
    var box = $('getApp');
    if (!box) return;
    box.textContent = '';
    var head = el('div', 'ga-head');
    var titles = el('div');
    titles.appendChild(el('h2', null, 'Get the app'));
    titles.appendChild(el('p', 'perms-note', 'The board, images, announcements and deploys on your phone, with notifications.'));
    head.appendChild(titles);
    // Android / iOS switch, top right
    var seg = el('div', 'ga-seg');
    seg.setAttribute('role', 'tablist');
    [['android', 'Android'], ['ios', 'iOS']].forEach(function (p) {
      var b = el('button', p[0] === platform ? 'on' : '', p[1]);
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(p[0] === platform));
      b.addEventListener('click', function () { if (platform !== p[0]) { platform = p[0]; render(); } });
      seg.appendChild(b);
    });
    head.appendChild(seg);
    box.appendChild(head);

    var cols = el('div', 'ga-cols');
    var steps = el('ol', 'ga-steps');
    if (platform === 'android') {
      var dl = el('a', 'btn btn-primary btn-sm ga-dl', 'Download for Android');
      dl.href = '/scuffed_dev/download/'; dl.rel = 'noopener';
      steps.appendChild(step(1, 'Download the APK on your phone', [dl, 'Not on the Play Store: it comes straight from the site\'s GitHub releases.']));
      steps.appendChild(step(2, 'Open it and tap Install', 'If Android asks, allow your browser to install apps.'));
      steps.appendChild(step(3, 'Scan the sign-in QR on this card', 'Use your Android camera or the scanner in scuffed_dev, then confirm in the app.'));
    } else {
      var a = el('a', 'ga-link', 'kanaris-beans.com/scuffed_dev/app');
      a.href = APP_URL; a.rel = 'noopener';
      steps.appendChild(step(1, 'Open this in Safari on your iPhone', [a, 'The iPhone version is the web app for now: no App Store needed.']));
      steps.appendChild(step(2, 'Tap Share, then Add to Home Screen', 'Open scuffed_dev from your Home Screen from then on. That\'s also where notifications work.'));
      steps.appendChild(step(3, 'Tap Scan sign-in QR in the app', 'Then scan the sign-in QR on this card. Use the app\'s scanner: the iPhone camera app would sign Safari in instead.'));
    }
    cols.appendChild(steps);
    // the QR side survives switching Android / iOS (a code you're showing stays up)
    var meNow = window.GameSocial && window.GameSocial.me && window.GameSocial.me();
    var key = meNow ? 'me:' + (meNow.name || '') : 'none';
    if (qrColEl && qrColEl.getAttribute('data-key') === key) { cols.appendChild(qrColEl); box.appendChild(cols); return; }

    var qrCol = qrColEl = el('div', 'ga-qr-col');
    qrCol.setAttribute('data-key', key);
    var out = el('div', 'ga-qr-out');
    var me = window.GameSocial && window.GameSocial.me && window.GameSocial.me();
    var device = window.GameSocial && window.GameSocial.device;
    if (!device || !device.available()) out.appendChild(el('p', 'perms-note', 'Signing in with a QR needs the site\'s player accounts.'));
    else if (!me) out.appendChild(el('p', 'perms-note', 'Make a profile in this browser first (top of the page), then come back to show your sign-in QR.'));
    else {
      out.appendChild(el('p', 'perms-note', 'Signs the app in as ' + (me.name || 'you') + '. The code works once, for 10 minutes.'));
      var show = el('button', 'btn btn-primary', 'Show sign-in QR');
      show.type = 'button';
      show.addEventListener('click', function () { make(out); });
      out.appendChild(show);
    }
    qrCol.appendChild(out);
    cols.appendChild(qrCol);
    box.appendChild(cols);
  }

  function make(out) {
    clearTimeout(timer);
    out.textContent = '';
    out.appendChild(el('p', 'perms-note', 'Making a code…'));
    window.GameSocial.device.create({}, label()).then(function (code) {
      out.textContent = '';
      var url = window.ScuffedSignin.url(code);
      var qr = el('div', 'ga-qr');
      out.appendChild(qr);
      out.appendChild(el('div', 'ga-code', code.slice(0, 4) + '-' + code.slice(4)));
      var left = el('p', 'perms-note ga-left');
      out.appendChild(left);
      var again = el('button', 'btn btn-sm btn-outline', 'New code');
      again.type = 'button';
      again.addEventListener('click', function () { make(out); });
      out.appendChild(again);
      var ends = Date.now() + 600000;
      (function tick() {
        var s = Math.max(0, Math.round((ends - Date.now()) / 1000));
        left.textContent = s ? 'Works once · expires in ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : 'Expired. Make a new code.';
        qr.classList.toggle('is-expired', !s);
        if (s && left.isConnected) timer = setTimeout(tick, 1000);
      })();
      return loadQr().then(function () {
        new window.QRCode(qr, { text: url, width: 200, height: 200, colorDark: '#0a0608', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
      }).catch(function (e) { qr.textContent = e.message + ' Type the code into the app instead.'; });
    }).catch(function (e) {
      out.textContent = '';
      var m = (e && e.message) || 'Couldn\'t make a code.';
      out.appendChild(el('p', 'perms-note', /function|schema|does not exist/i.test(m) ? 'Signing in with a QR needs the device-links database update.' : m));
    });
  }

  // draw once the account is known; the hub section itself is only shown to staff (core.js)
  function start() {
    if (!$('getApp')) return;
    render();
    if (window.GameSocial && window.GameSocial.ready) window.GameSocial.ready(render);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
