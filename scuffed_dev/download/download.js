(function () {
  'use strict';
  var signin = window.ScuffedSignin;
  var url = new URL(location.href);
  var code = signin.read(url);
  var android = /Android/i.test(navigator.userAgent);
  var ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var download = document.getElementById('downloadApk');
  var openApp = document.getElementById('openApp');
  var openWeb = document.getElementById('openWeb');
  var status = document.getElementById('installStatus');
  var note = document.getElementById('installNote');

  if (code) {
    openWeb.href = signin.url(code).replace('#', '?web=1#');
    openWeb.textContent = 'Continue in browser';
  }
  if (ios) {
    download.hidden = true;
    status.textContent = 'Open scuffed_dev in Safari. Tap Share, then Add to Home Screen.';
    note.textContent = 'If you already added scuffed_dev, open it from your Home Screen and use its QR scanner.';
    note.hidden = false;
    return;
  }
  if (!android) return;

  openApp.hidden = false;
  openApp.href = signin.androidIntent(code);
  note.textContent = code ?
    'After installing, return here and tap Open app to confirm sign-in. The code is valid for 10 minutes after it was made.' :
    'Open the APK from Downloads and tap Install. Android may ask you to allow installs from this browser.';
  note.hidden = false;

  var requested = false;
  function markRequested() {
    requested = true;
    status.textContent = 'Your APK download was requested. Tap Download Android APK if it hasn’t started.';
  }
  download.addEventListener('click', markRequested);
  openApp.addEventListener('click', function () { requested = true; });
  if (url.searchParams.has('open')) return;

  // Where supported, skip the download if a camera app kept the link in its browser anyway.
  var related = navigator.getInstalledRelatedApps ?
    navigator.getInstalledRelatedApps().catch(function () { return []; }) : Promise.resolve([]);
  related.then(function (apps) {
    if (apps.some(function (app) { return app.id === signin.packageName; })) {
      status.textContent = 'scuffed_dev is installed. Tap Open app to continue.';
      return;
    }
    var key = 'scuffed-apk-requested';
    try {
      if (sessionStorage.getItem(key) === url.hash) return markRequested();
    } catch (err) { /* The download link still works without storage. */ }
    function startDownload() {
      if (requested || document.hidden) return;
      document.removeEventListener('visibilitychange', startDownload);
      try { sessionStorage.setItem(key, url.hash); } catch (err) { /* fine */ }
      download.click();
    }
    document.addEventListener('visibilitychange', startDownload);
    setTimeout(startDownload, 700);
  });
})();
