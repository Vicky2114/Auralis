# Deploying Auralis (no credit card)

- **Backend** (FastAPI + Pipecat + WebRTC) → **Render** free tier (Docker)
- **Client** (Vite/React) → **Vercel** (static)
- **TURN** (WebRTC media relay) → **Metered.ca** free tier (email signup, no card)

Order: **TURN creds → Backend (Render) → Frontend (Vercel)**.

> **Free-tier caveats (Render):**
> - Service **sleeps after ~15 min idle** and takes ~1 min to wake — the first
>   connect after idle may time out; just retry once it's awake.
> - **512 MB RAM** is tight for the audio pipeline; if it crashes (OOM) you'd
>   need a paid instance.
> - **No persistent disk** on free — the memory store resets on restart/redeploy.

---

## 1. TURN credentials (Metered.ca — free, no card)

1. Sign up at **https://www.metered.ca/** (email only).
2. Dashboard → **TURN Server** → copy:
   ```
   TURN_URL          e.g. turn:standard.relay.metered.ca:80
   TURN_USERNAME
   TURN_CREDENTIAL
   ```

---

## 2. Backend on Render

1. Make sure the repo is pushed to GitHub (it is: `Vicky2114/Auralis`).
2. **render.com** → sign up (GitHub login, no card) → **New + → Blueprint**.
3. Pick the `Auralis` repo. Render reads `render.yaml` and the `server/Dockerfile`.
4. Set the secret env vars when prompted (these are `sync:false`, not in git):

   | Key | Value |
   |---|---|
   | `GOOGLE_API_KEY` | your working Google key |
   | `TURN_URL` | from Metered |
   | `TURN_USERNAME` | from Metered |
   | `TURN_CREDENTIAL` | from Metered |

   (`GEMINI_LIVE_MODEL` and `PORT` are already set in `render.yaml`.)
5. **Create** → wait for the Docker build + deploy (first build is slow, ~5–10 min).
6. You get a URL like `https://auralis-api.onrender.com`. Open `/` → `{"status":"ok"}`,
   and `/api/diag` should show `ok:true`.

---

## 3. Frontend on Vercel

1. **vercel.com** → sign up (GitHub login, no card) → **Add New → Project** →
   import `Vicky2114/Auralis`.
2. **Root Directory: leave as repo root** (root `vercel.json` builds the client).
3. **Environment Variables** (Production + Preview):

   | Name | Value |
   |---|---|
   | `VITE_API_BASE` | `https://auralis-api.onrender.com` |
   | `VITE_TURN_URL` | from Metered |
   | `VITE_TURN_USERNAME` | from Metered |
   | `VITE_TURN_CREDENTIAL` | from Metered |

4. **Deploy.**

> Vite inlines `VITE_*` vars at **build time** — after changing any, **redeploy**.

---

## 4. Verify

1. Open the Vercel URL (wake the Render backend first by visiting its `/` URL —
   it may be asleep).
2. Tap the orb → allow mic.
3. Expect: **Connecting → Preparing → greeting → Live**.
4. If it sticks:
   - Render **Logs** for backend errors / `1011` (Gemini quota).
   - Browser console for ICE errors → TURN creds wrong/missing.

---

## Updating later
- Backend: push to `main` → Render auto-deploys (`autoDeploy: true`).
- Frontend: push to `main` → Vercel auto-deploys.

## If you outgrow the free tier
512 MB / cold starts hurt voice UX. Options: Render paid instance ($7/mo, no
sleep, more RAM), or Fly.io (needs a card but has a free allowance and keeps a
machine warm). The `server/Dockerfile` works on any of them.
