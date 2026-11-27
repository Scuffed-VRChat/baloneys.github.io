// Keep the QR code in the fragment so it stays on the device until sign-in.
(function () {
  'use strict';
  var SITE = 'https://kanaris-beans.com';
  var APP = '/scuffed_dev/app/';
  var DOWNLOAD = '/scuffed_dev/download/';
  var PACKAGE = 'com.kanarisbeans.scuffeddev';

  function codeOf(value) {
    var code = String(value || '').trim().toUpperCase().replace(/-/g, '');
    return /^[A-HJ-NP-Z2-9]{8}$/.test(code) ? code : null;
  }

  function read(url) {
    var match = /^#link\/([A-Za-z0-9-]+)$/.exec(url.hash);
    return codeOf(match ? match[1] : url.searchParams.get('signin'));
  }

  function parse(text) {
    try {
      var url = new URL(String(text || '').trim());
      return url.origin === SITE && (url.pathname === APP || url.pathname === DOWNLOAD) ? read(url) : null;
    } catch (err) {
      return codeOf(text);
    }
  }

  function fragment(code) { return code ? '#link/' + code : ''; }
  function url(code) { return SITE + APP + fragment(code); }
  function androidIntent(code) {
    var target = APP + (code ? '?signin=' + code : '');
    var fallback = SITE + DOWNLOAD + '?open=1' + fragment(code);
    return 'intent://' + new URL(SITE).host + target + '#Intent;scheme=https;package=' + PACKAGE +
      ';S.browser_fallback_url=' + encodeURIComponent(fallback) + ';end';
  }

  function standalone() {
    return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches ||
      new RegExp('^android-app://' + PACKAGE.replace(/\./g, '\\.') + '(?:/|$)').test(document.referrer);
  }

  window.ScuffedSignin = { read: read, parse: parse, url: url, androidIntent: androidIntent, packageName: PACKAGE };

  var current = new URL(location.href);
  if (current.pathname === APP && !current.searchParams.has('web') && !standalone()) {
    var code = read(current);
    if (code) location.replace(DOWNLOAD + fragment(code));
  }
})();
