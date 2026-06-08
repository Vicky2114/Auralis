# Deploying Auralis (no credit card)

- **Backend** (FastAPI + Pipecat) → **Render** free tier (Docker)
- **Client** (Vite/React) → **Vercel** (static)
- **WebRTC media** → **Daily** (free tier; TURN/STUN included — no separate TURN setup)

Order: **Daily API key → Backend (Render) → Frontend (Vercel)**.

> **Why Daily:** Daily hosts the audio/video media on its own global infra
> (TURN included), so it works on Render (no public UDP needed) **and** the
> heavy WebRTC work is off your tiny Render box — which is what makes
> **multiple users** hold up far better than self-hosted WebRTC.

> **Free-tier caveats (Render):** sleeps after ~15 min idle (first connect may
> need a retry while it wakes), 512 MB RAM, no persistent disk (memory resets
> on restart). Daily free tier: ~10,000 participant-minutes/month.

> **Local dev note:** `daily-python` has **no Windows wheel**, so the backend
> can't run on Windows directly. Use Render for testing, or run the backend in
> **WSL / macOS / Linux**. The client and tests still work on Windows.

---

## 1. Daily API key (free, no card)

1. Sign up at **https://dashboard.daily.co/** (free).
2. Go to **Developers** → copy your **API key**.

That's the only credential Daily needs — it handles rooms/tokens/TURN for you.

---

## 2. Backend on Render

1. Repo is on GitHub (`Vicky2114/Auralis`).
2. **render.com** → **New + → Blueprint** → pick the repo (reads `render.yaml` + `server/Dockerfile`).
3. Set the secret env vars (`sync:false`, not in git):

   | Key | Value |
   |---|---|
   | `GOOGLE_API_KEY` | your working Google key |
   | `DAILY_API_KEY` | from the Daily dashboard |

   (`GEMINI_LIVE_MODEL` and `PORT` are already in `render.yaml`.)
4. **Create** → Docker build + deploy (~5–10 min) → URL like `https://auralis-api.onrender.com`.
5. Check `/` → `{"status":"ok"}` and `/api/diag` → `ok:true`.

---

## 3. Frontend on Vercel

1. **vercel.com** → import the repo.
2. **Root Directory = `client`** (Vite auto-detected; `client/vercel.json` handles the build).
3. **Environment Variable** (Production + Preview):

   | Name | Value |
   |---|---|
   | `VITE_API_BASE` | `https://auralis-api.onrender.com` |

   (No TURN vars needed anymore — Daily handles media.)
4. **Deploy.**

> Vite inlines `VITE_*` at build time — redeploy after changing env vars.

---

## 4. Verify

1. Wake the Render backend (open its `/` URL).
2. Open the Vercel URL → tap the orb → allow mic.
3. Expect: **Connecting → Preparing → greeting → Live** — and now it should hold
   up with **two devices** at once.
4. If it sticks: Render **Logs** (Daily room creation / Gemini `1011` quota) and
   the browser console.

---

## Updating later
- Backend: push to `main` → Render auto-deploys.
- Frontend: push to `main` → Vercel auto-deploys.

## If you outgrow the free tier
Render free (512 MB / cold starts) still limits concurrency. Bump to a paid
Render instance (more RAM/CPU) or any Docker host — `server/Dockerfile` is portable.
