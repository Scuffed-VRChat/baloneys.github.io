// scuffed_dev/app/sw.js: the app's service worker (scope /scuffed_dev/app/).
//   - shows push notifications sent by the scuffed-perms Worker (src/push.js) and opens the right screen on tap
//   - keeps the app shell available offline (network first, so updates show up straight away)
// Bump VERSION when the shell list changes.
const VERSION = "scd-app-v4";
const SHELL = [
  "./", "./app.css", "./app.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/badge-96.png",
  "/scuffed_dev/images-crop.js", "/scuffed_dev/signin-link.js", "/scuffed_dev/deploy.js", "/scuffed_dev/images.css", "/scuffed_dev/theme.css"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("scd-app-") && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first for our own files (fresh code every launch), cache as the offline fallback. Everything else
// (Supabase, the Worker, GitHub) goes straight to the network untouched.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (!(url.pathname.startsWith("/scuffed_dev/") || /^\/(games-[a-z-]+|style|home|site)\.(js|css)$/.test(url.pathname))) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && url.search === "") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match("./"))));
});

// A notification from the Worker: { id, kind, title, body, url, tag }.
self.addEventListener("push", (e) => {
  let n = {};
  try { n = e.data ? e.data.json() : {}; } catch (err) { n = { title: "scuffed_dev", body: e.data ? e.data.text() : "" }; }
  const title = n.title || "scuffed_dev";
  e.waitUntil(self.registration.showNotification(title, {
    body: n.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",          // Android's status bar icon (white on transparent)
    tag: n.tag || undefined,
    renotify: !!n.tag,
    timestamp: Date.now(),
    vibrate: n.kind === "deploy" && /fail/i.test(title) ? [80, 60, 80, 60, 160] : [60, 40, 60],
    data: { url: n.url || "./#history", id: n.id || null, kind: n.kind || "" }
  }).then(() => broadcast({ type: "push", n })));
});

// Tap: bring the app forward on the right screen (or open it).
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "./#history", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const win = list.find((c) => c.url.startsWith(self.registration.scope));
    if (win) { win.postMessage({ type: "open", url: target, id: e.notification.data && e.notification.data.id }); return win.focus(); }
    return self.clients.openWindow(target);
  }));
});

function broadcast(msg) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => list.forEach((c) => c.postMessage(msg)));
}
