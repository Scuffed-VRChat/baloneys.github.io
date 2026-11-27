// scuffed-perms Worker: push notifications for the scuffed_dev app (kanaris-beans.com/scuffed_dev/app/ and its APK).
//
// Web Push, standard and Firebase-free: each phone's subscription (from the app) is stored in Supabase
// (scuffed_push_subs, supabase/migrations/2026-11-28-scuffed-dev-app-push.sql). To send, the Worker:
//   1. signs a VAPID token (ES256) so the push service knows it's us,
//   2. encrypts the message for that phone (RFC 8291 "aes128gcm": ECDH + HKDF + AES-GCM, all WebCrypto),
//   3. POSTs it to the phone's push service, and forgets subscriptions the service says are gone (404 / 410).
// Every notification is also written to scuffed_push_log: the app's notification history.
//
// Who gets what:  board, announce  -> moderator and up      deploy, suggest -> developers
// Each phone can switch kinds off (prefs). Needs these Worker settings:
//   VAPID_PUBLIC        text   the app's public key (also served at GET /push/key)
//   VAPID_PRIVATE_JWK   secret the matching private key, as a JWK
//   SUPABASE_SERVICE_KEY secret the project's secret key, sb_secret_... (Settings > API Keys; a legacy service_role
//                               key also works until Supabase retires those). Reads subscriptions, writes history.
// Missing any of them = notifications quietly off; nothing else in the Worker depends on this file.

const enc = new TextEncoder();
export const MIN_LEVEL = { board: 2, announce: 2, world: 2, test: 2, deploy: 4, suggest: 4 };
const CONTACT = "https://kanaris-beans.com/scuffed_dev/app/";   // VAPID "sub": a URL, not anyone's email

/* ---------- bytes ---------- */

export function b64url(bytes) {
  let s = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64url(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/* ---------- RFC 8291 message encryption ---------- */

// Encrypts `plaintext` (bytes) for one subscription { p256dh, auth }. `fixed` ({ salt, asPrivateJwk }) is only for
// the RFC test vector; normally the salt and the sender key pair are fresh for every message.
export async function encryptPayload(plaintext, sub, fixed) {
  const uaPublic = unb64url(sub.p256dh);
  const authSecret = unb64url(sub.auth);
  const salt = fixed ? unb64url(fixed.salt) : crypto.getRandomValues(new Uint8Array(16));
  let asPrivate, asPublic;
  if (fixed) {
    asPrivate = await crypto.subtle.importKey("jwk", fixed.asPrivateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    asPublic = unb64url(fixed.asPublic);
  } else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}

/* ---------- VAPID ---------- */

const vapidCache = new Map();
export async function vapidAuth(endpoint, env, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const hit = vapidCache.get(aud);
  if (hit && hit.exp - 600 > now / 1000) return hit.value;
  const exp = Math.floor(now / 1000) + 12 * 3600;
  const head = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64url(enc.encode(JSON.stringify({ aud, exp, sub: CONTACT })));
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE_JWK), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`)));
  const value = `vapid t=${head}.${body}.${b64url(sig)}, k=${env.VAPID_PUBLIC}`;
  vapidCache.set(aud, { exp, value });
  return value;
}

export function pushReady(env) { return !!(env.VAPID_PUBLIC && env.VAPID_PRIVATE_JWK && env.SUPABASE_SERVICE_KEY && env.SUPABASE_URL); }

// One message to one phone. Returns the push service's HTTP status (201 = accepted, 404/410 = gone).
export async function sendPush(sub, message, env, urgency = "normal") {
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuth(sub.endpoint, env),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: urgency,
    },
    body,
  });
  return res.status;
}

/* ---------- Supabase (secret key) ---------- */

// A new secret key (sb_secret_...) goes on the apikey header only: it isn't a JWT, and Supabase rejects it on
// Authorization: Bearer ("Invalid JWT"). A legacy service_role key is a JWT and wants both headers.
export function sbKeyHeaders(key) {
  const k = String(key || "");
  return k.startsWith("eyJ") ? { apikey: k, Authorization: `Bearer ${k}` } : { apikey: k };
}
async function sb(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...sbKeyHeaders(env.SUPABASE_SERVICE_KEY),
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${init.method || "GET"} ${path.split("?")[0]}: ${res.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}
export async function getState(env, key) {
  const rows = await sb(env, `scuffed_push_state?key=eq.${encodeURIComponent(key)}&select=value`);
  return rows && rows[0] ? rows[0].value : null;
}
export async function setState(env, key, value) {
  await sb(env, "scuffed_push_state", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key, value: String(value), updated_at: new Date().toISOString() }) });
}

/* ---------- fan-out ---------- */

// Sends one notification to everyone allowed to get it (their level, their prefs) and records it in the history.
// `only` (an endpoint) sends to that phone only: the app's "Send a test" button.
export async function notify(env, n, only) {
  if (!pushReady(env)) return { sent: 0, skipped: "push not configured" };
  const kind = n.kind;
  const minLevel = MIN_LEVEL[kind] || 2;
  const title = String(n.title || "").slice(0, 200) || "scuffed_dev";
  const full = String(n.body || "").replace(/\r/g, "");
  let logId = null;
  if (!only) {
    const rows = await sb(env, "scuffed_push_log", { method: "POST", body: JSON.stringify({ kind, title, body: full.slice(0, 8000), url: n.url || "", min_level: minLevel, meta: n.meta || {} }) });
    logId = rows && rows[0] ? rows[0].id : null;
  }
  const subs = only
    ? await sb(env, `scuffed_push_subs?endpoint=eq.${encodeURIComponent(only)}&select=*`)
    : await sb(env, `scuffed_push_subs?level=gte.${minLevel}&select=*`);
  const targets = (subs || []).filter((s) => only || (s.prefs || {})[kind] !== false);
  // the push service caps a message at ~4 KB encrypted; long announcements are trimmed here and shown in full in
  // the app's history (the notification opens it)
  const message = { id: logId, kind, title, body: full.length > 2400 ? full.slice(0, 2400).trimEnd() + "…" : full, url: n.url || "/scuffed_dev/app/#history", tag: n.tag || `${kind}-${logId || Date.now()}` };
  let sent = 0;
  const gone = [], failed = [];
  for (let i = 0; i < targets.length; i += 10) {
    await Promise.all(targets.slice(i, i + 10).map(async (s) => {
      try {
        const status = await sendPush(s, message, env, kind === "deploy" && /fail/i.test(title) ? "high" : "normal");
        if (status >= 200 && status < 300) sent++;
        else if (status === 404 || status === 410) gone.push(s.endpoint);
        else failed.push(s);
      } catch (e) { failed.push(s); }
    }));
  }
  for (const ep of gone) await sb(env, `scuffed_push_subs?endpoint=eq.${encodeURIComponent(ep)}`, { method: "DELETE" }).catch(() => {});
  for (const s of failed) {
    // a phone that keeps failing (10 in a row) is dropped; it subscribes again next time the app opens
    if ((s.fails || 0) >= 9) await sb(env, `scuffed_push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" }).catch(() => {});
    else await sb(env, `scuffed_push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "PATCH", body: JSON.stringify({ fails: (s.fails || 0) + 1 }) }).catch(() => {});
  }
  if (logId) await sb(env, `scuffed_push_log?id=eq.${logId}`, { method: "PATCH", body: JSON.stringify({ sent }) }).catch(() => {});
  return { sent, gone: gone.length, failed: failed.length, id: logId };
}

/* ---------- the once-a-minute check ---------- */

// New dev board activity since last time (scuffed_dev_updates is the board's own timeline).
async function boardUpdates(env) {
  const raw = await getState(env, "board_last_id");
  const last = Number(raw);
  if (raw === null || raw === "" || Number.isNaN(last)) {
    // first run: start from now, don't replay the whole board
    const top = await sb(env, "scuffed_dev_updates?select=id&order=id.desc&limit=1");
    await setState(env, "board_last_id", top && top[0] ? top[0].id : 0);
    return 0;
  }
  const rows = await sb(env, `scuffed_dev_updates?id=gt.${last}&order=id.asc&limit=20&select=id,item_id,author_name,kind,body,created_at,scuffed_dev_items(title,kind,created_at)`);
  if (!rows || !rows.length) return 0;
  for (const u of rows) {
    const item = u.scuffed_dev_items || {};
    const title = item.title ? `#${u.item_id} ${item.title}` : `Card #${u.item_id}`;
    const isNewSuggestion = item.kind === "suggestion" && u.kind === "event" && Math.abs(Date.parse(u.created_at) - Date.parse(item.created_at)) < 10000;
    const line = `${u.author_name || "Someone"}: ${u.body}`.slice(0, 600);
    await notify(env, { kind: "board", title: `🧩 ${title}`.slice(0, 120), body: line, url: `/scuffed_dev/app/#board/${u.item_id}`, tag: `board-${u.item_id}`, meta: { item: u.item_id, update: u.id } });
    if (isNewSuggestion) await notify(env, { kind: "suggest", title: "💡 New suggestion on the dev board", body: `${u.author_name || "Someone"} suggested: ${item.title}`, url: `/scuffed_dev/app/#board/${u.item_id}`, tag: `suggest-board-${u.item_id}`, meta: { item: u.item_id } });
  }
  await setState(env, "board_last_id", rows[rows.length - 1].id);
  return rows.length;
}

// Finished GitHub Pages builds since last time (developers only).
async function deployUpdates(env, pagesRuns) {
  const runs = (await pagesRuns()).filter((r) => r.status === "completed").sort((a, b) => a.id - b.id);
  if (!runs.length) return 0;
  const last = Number(await getState(env, "deploy_last_run")) || 0;
  if (!last) { await setState(env, "deploy_last_run", runs[runs.length - 1].id); return 0; }
  const fresh = runs.filter((r) => r.id > last);
  for (const r of fresh) {
    const ok = r.conclusion === "success";
    if (r.conclusion === "cancelled" || r.conclusion === "skipped") continue;   // a newer build took over; its own result follows
    const what = (r.message || "").split("\n")[0].slice(0, 200) || r.sha.slice(0, 7);
    await notify(env, {
      kind: "deploy",
      title: ok ? "🚀 Live on kanaris-beans.com" : "❌ Deploy failed",
      body: ok ? what : `${what}\n\nThe GitHub Pages build failed. Open the app to re-deploy.`,
      url: "/scuffed_dev/app/#deploys", tag: `deploy-${r.sha.slice(0, 12)}`, meta: { sha: r.sha, run: r.url, ok },
    });
  }
  if (fresh.length) await setState(env, "deploy_last_run", fresh[fresh.length - 1].id);
  return fresh.length;
}

// A new world build: the Unity editor commits <world>/version.txt after each PC / Quest upload. This reads the copy
// kanaris-beans.com serves, so the notification goes out once the world's version checker can see it.
export const WORLD_FILES = [
  { slug: "scuffed", name: "Scuffed" },
  { slug: "straya", name: "Straya" },
];
export function parseVersion(text) {
  const v = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^\s*(pc|quest|pc_uploaded|quest_uploaded)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) v[m[1]] = m[2];
  }
  const pc = parseInt(v.pc, 10), quest = parseInt(v.quest, 10);
  if (Number.isNaN(pc) && Number.isNaN(quest)) return null;
  return { pc: Number.isNaN(pc) ? null : pc, quest: Number.isNaN(quest) ? null : quest, pcAt: v.pc_uploaded || "", questAt: v.quest_uploaded || "" };
}
export function worldNotice(world, before, now) {
  const pcNew = now.pc !== null && now.pc !== before.pc, questNew = now.quest !== null && now.quest !== before.quest;
  if (!pcNew && !questNew) return null;
  const both = pcNew && questNew && now.pc === now.quest;
  const what = both ? `PC + Quest v${now.pc}` : [pcNew ? `PC v${now.pc}` : "", questNew ? `Quest v${now.quest}` : ""].filter(Boolean).join(", ");
  const lines = [];
  if (pcNew) lines.push(`PC v${now.pc} is up${now.pcAt ? ` (uploaded ${now.pcAt})` : ""}.`);
  if (questNew) lines.push(`Quest v${now.quest} is up${now.questAt ? ` (uploaded ${now.questAt})` : ""}.`);
  if (now.pc !== null && now.quest !== null) {
    if (now.pc === now.quest) lines.push(`PC and Quest are both on v${now.pc} now.`);
    else if (now.pc > now.quest) lines.push(`Quest is still on v${now.quest}: the builds match once Quest v${now.pc} is up.`);
    else lines.push(`PC is still on v${now.pc}: the builds match once PC v${now.quest} is up.`);
  }
  return {
    kind: "world", title: `🌍 ${world.name} world update: ${what}`, body: lines.join("\n"),
    url: "/scuffed_dev/app/#history", tag: `world-${world.slug}`, meta: { world: world.slug, pc: now.pc, quest: now.quest },
  };
}
async function worldUpdates(env, fetchFn) {
  let count = 0;
  for (const w of WORLD_FILES) {
    const res = await fetchFn(`https://kanaris-beans.com/${w.slug}/version.txt?scd=${Date.now()}`, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
    if (!res.ok) continue;
    const now = parseVersion(await res.text());
    if (!now) continue;
    const key = `world_${w.slug}`, stored = await getState(env, key), value = `pc=${now.pc};quest=${now.quest}`;
    if (stored === value) continue;
    if (stored === null || stored === "") { await setState(env, key, value); continue; }   // first run: remember, don't announce
    const before = parseVersion(stored.replace(/;/g, "\n"));
    const n = before && worldNotice(w, before, now);
    if (n) { await notify(env, n); count++; }
    await setState(env, key, value);
  }
  return count;
}

export async function runSchedule(env, pagesRuns, fetchFn = fetch) {
  if (!pushReady(env)) return { skipped: "push not configured" };
  const out = {};
  try { out.world = await worldUpdates(env, fetchFn); } catch (e) { out.worldError = String(e.message || e); }
  try { out.board = await boardUpdates(env); } catch (e) { out.boardError = String(e.message || e); }
  try { out.deploys = await deployUpdates(env, pagesRuns); } catch (e) { out.deployError = String(e.message || e); }
  return out;
}
