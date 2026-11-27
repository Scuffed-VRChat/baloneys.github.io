import { bindings, defineConfig, triggers } from "cf/config";

export default defineConfig({
  worker: {
    name: "scuffed-perms",
    entrypoint: "./src/index.js",
    compatibilityDate: "2026-11-01",
    env: {
      // The site's Supabase project (same values as /games-config.js; the anon key is public by design).
      SUPABASE_URL: bindings.text("https://omumcgompiqmrfxqcezw.supabase.co"),
      SUPABASE_ANON_KEY: bindings.text(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tdW1jZ29tcGlxbXJmeHFjZXp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NzUwNjQsImV4cCI6MjEwNzE1MTA2NH0.F90ZvVeSf_0T1WO7Mte29sqBH84KvNzPhSC67Qa7zF4"
      ),
      // Where the role lists live.
      REPO_OWNER: bindings.text("Scuffed-VRChat"),
      REPO_NAME: bindings.text("baloneys.github.io"),
      BRANCH: bindings.text("main"),
      ROLES_DIR: bindings.text("scuffed_perms/roles"),
      // Pages allowed to call this Worker from a browser.
      ALLOWED_ORIGINS: bindings.text("https://kanaris-beans.com,https://www.kanaris-beans.com,http://127.0.0.1:8765"),
      // GITHUB_TOKEN (secret, added after deploying): fine-grained token, owner Scuffed-VRChat,
      // only baloneys.github.io, Contents read & write. Without it the lists are view-only.

      // Push notifications for the scuffed_dev app (src/push.js). The public key is public by design; the private
      // key (VAPID_PRIVATE_JWK) and SUPABASE_SERVICE_KEY are secrets added with `wrangler secret put`.
      VAPID_PUBLIC: bindings.text("BIqzE_yNA_ZuqW3KiGYzzw-5AXQC69VA9qq26hX_Y5_IGaB2XDo7o0CIVdohsAA8TSFuaEsAWTLp6gIz_zPOpBI"),
    },
    // once a minute: dev board activity + finished GitHub Pages builds -> notifications
    triggers: [triggers.scheduled({ schedule: "* * * * *" })],
  },
});
