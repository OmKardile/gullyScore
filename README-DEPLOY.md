# GullyScore — Web Deploy to Render

Pre-built static web app (Expo / React Native Web export of the GullyScore RN
app, v1.4.3) with everything needed to host it permanently on Render.

**What's new in 1.4.3** — fixes the "scoring screen hangs up" report:
rapid taps on the scoring pad are recorded 1:1 (previously React's async
state commits made a fast tapper overwrite their own balls — the pad looked
deaf), and the over-end bowler sheet can never again be hidden behind the
stacked shot-direction modal (tap-anywhere-outside now dismisses it).

What's inside:

- `dist/` — the ready-to-serve web export (single-page app, ~4.4 MB;
  fonts self-hosted under `dist/fonts/` — zero runtime third-party
  dependencies, not even Google Fonts)
- `render.yaml` — Render Blueprint: a free **Static Site** (global CDN,
  no cold starts) that publishes `dist/` with no build step
- `src/`, `public/fonts/`, `package.json`, `app.json`, `tsconfig.json`,
  `assets/` — full RN source, in case you later want Render to build from
  source instead
- `.gitignore`

No secrets are included. The Android folder / release keystore is
intentionally NOT part of this bundle. The Supabase publishable key inside
the app is public by design — data access is protected by Postgres row-level
security keyed to your sync space code.

---

## Deploy in 5 minutes

### 1. Push this folder to GitHub

Create an empty repo at https://github.com/new (e.g. `gullyscore-web`,
no README/license — keep it empty). Then:

```bash
unzip GullyScore-Render-Deploy.zip
cd gullyscore-web
git remote add origin https://github.com/<you>/gullyscore-web.git
git push -u origin main
```

(The folder already contains a git history with one commit, so no `git init`
or `git add` is needed. If you kept the .git folder out, run
`git init -b main && git add -A && git commit -m "GullyScore 1.4.3"` first.)

### 2. Deploy on Render

Sign up / log in at https://dashboard.render.com (Sign in with GitHub):

**Option A — Blueprint (recommended):**
1. **New → Blueprint**
2. Select your `gullyscore-web` repo (grant access if asked)
3. Click **Apply** — that's it. `render.yaml` provisions everything.

**Option B — Manual Static Site:**
1. **New → Static Site**
2. Select the repo
3. Build Command: `echo prebuilt` · Publish Directory: `./dist`
4. **Create Static Site**

In ~1 minute the app is live at `https://gullyscore.onrender.com`
(if that subdomain is taken, Render picks a close variant — you can rename
it in the service **Settings** tab).

### 3. Use it

Open the URL — everything works right in the browser: scoring, stats,
teams, tournaments, cloud sync. Join the demo space `2XMAY93M` in
**Settings → Cloud Sync** to see live sync between devices/browsers.
Each browser keeps its own local data until you join a space.

---

## Updating the app later

The repo ships a pre-built `dist/`, so the usual flow is:

**Already deployed (recommended for this 1.4.3 update):**

1. Download & unzip `GullyScore-Render-Deploy.zip`.
2. Copy its `gullyscore-web/*` over your local clone of the deployed repo
   (replaces `dist/`, `src/`, `app.json`, …).
3. Commit + push — Render auto-deploys on push:

```bash
git add -A && git commit -m "GullyScore 1.4.3 — scoring-pad rapid-tap + stacked-overlay fixes"
git push
```

**Building from source instead:** change code (or ask for changes), then
rebuild locally: `npm install && npx expo export --platform web` (needs
Node 20+), commit the refreshed `dist/` and push — Render auto-deploys on
push.

Or switch to building on Render: in `render.yaml` set

```yaml
buildCommand: npm ci && npx expo export --platform web
```

and keep `staticPublishPath: ./dist`. Same publish path either way.

## Troubleshooting

- **Deploy says the name is taken** — change `name:` in `render.yaml` (or the
  service name in the dashboard) to e.g. `gullyscore-<something>`; the subdomain
  follows the name.
- **404 on `/`** — check the service's *Publish Directory* is exactly `./dist`.
- **Blank page after a future rebuild** — make sure you committed the whole
  `dist/` (index.html + `_expo/static/...`) and that index.html's script src
  matches the hashed file in `_expo/static/js/web/`.
- **Old version showing** — the blueprint caches `/_expo/static/*` for 1 year
  (hashed filenames make this safe); a hard refresh (Ctrl/Cmd+Shift+R) picks
  up a new index.html immediately.

## Cost

Render static sites are **free** (100 GB bandwidth/month, CDN-backed,
no spin-down). A credit card is not required.
