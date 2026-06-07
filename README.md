# Auralis — Pipecat + Gemini Live voice buddy

A daily-companion voice app: pick a persona (therapist, mentor, friend, coach,
listener), talk to it in real time, and it learns about you across sessions.
Backend uses **Pipecat** with **Gemini Live** (native-audio dialog) plus
**Google Search** grounding. Frontend is **Vite + React** with an animated
aura orb that breathes, pulses with the bot's voice, and lights up when you
speak.

## Quick start (one command)

This is an npm-workspaces monorepo — the root orchestrates both the Python
server and the React client.

```bash
npm run setup     # installs client deps, runs `uv sync`, creates server/.env
# → add your GOOGLE_API_KEY to server/.env
npm run dev       # boots BOTH: server on :7860 + client on :5173
```

Open <http://localhost:5173>. That's it.

| Command | What it does |
|---|---|
| `npm run setup` | One-time: client deps + `uv sync` + copies `.env.example` → `.env` |
| `npm run dev` | Runs server + client together (via `concurrently`) |
| `npm run dev:server` | Server only (`uv run python server.py`) |
| `npm run dev:client` | Client only (Vite) |
| `npm run build` | Production build of the client |

> Requires [`uv`](https://docs.astral.sh/uv/) for the Python side and Node ≥ 18.
> On Windows you can also just double-click `start.bat`.

The manual two-terminal flow is still documented below if you prefer it.

```
Auralis/
├── package.json   # monorepo root — `npm run dev` runs both sides
├── scripts/       # setup-env.mjs (creates server/.env on first run)
├── server/        # FastAPI + Pipecat bot (Python 3.11+)
│   ├── bot.py             # Pipecat pipeline w/ Gemini Live + tools
│   ├── server.py          # WebRTC signaling + memory API
│   ├── personas.py        # 5 personas (Aura, Sage, Spark, Coach, Echo)
│   ├── memory.py          # JSON-file per-user memory store
│   ├── pyproject.toml     # deps
│   ├── .env.example
│   └── data/memory/       # auto-created
└── client/        # Vite + React UI
    ├── src/
    │   ├── App.tsx
    │   ├── components/    # AuraOrb, PersonaSelector, Thread, MemoryPanel
    │   ├── hooks/useVoiceClient.ts
    │   └── styles/index.css
    ├── index.html
    └── package.json
```

## What you get

- **Voice-first conversation** with Gemini's native-audio Live model (no STT/TTS hop).
- **Five personas** — each has its own voice, color, and system prompt.
- **Persistent memory** — the bot calls a `remember(fact, category)` tool when
  something is worth keeping. Facts inject back into the system prompt next
  session. The user can ask it to forget; there's also a "Forget everything"
  button.
- **Google Search grounding** — Gemini Live's native `google_search` tool is
  enabled, so the bot can answer factual questions without hallucinating.
- **Animated aura orb** — breathes when idle, pulses with the bot's audio
  level, secondary ring lights up when you're talking.
- **Live transcript thread** — both sides of the conversation stream in.

## Setup

### 1. Backend

```bash
cd server
cp .env.example .env       # add your GOOGLE_API_KEY
uv sync                    # or: pip install -r <(uv export --no-hashes)
python server.py
```

If you don't use `uv`, install deps with pip directly:

```bash
pip install "pipecat-ai[google,silero,webrtc]>=0.0.90" fastapi "uvicorn[standard]" python-dotenv loguru pydantic
python server.py
```

Server listens on `http://localhost:7860`.

Get a Google AI Studio key at <https://aistudio.google.com/apikey>. The default
model is `gemini-2.5-flash-preview-native-audio-dialog`. If your key has access
to a newer Gemini Live model (e.g. `gemini-3.1-flash-live`), set
`GEMINI_LIVE_MODEL` in `.env`.

### 2. Frontend

```bash
cd client
npm install
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api/*` to the backend, so you
don't need to configure CORS.

### 3. First chat

1. Pick a buddy from the right sidebar.
2. Click **Talk to <name>** — your browser will ask for mic access.
3. They'll greet you. Just talk.
4. End the session when you're done; check **What I remember about you** to see
   what got saved.

## How memory works

Memory is *model-driven*. The bot has a `remember` tool with this contract:

> Save a single durable fact about the user that should persist across
> sessions. Use sparingly — only for things that will matter next time.

So instead of a post-hoc summarizer guessing what mattered, the model itself
chooses, mid-conversation, what's worth keeping. Facts are bucketed
(`identity`, `relationships`, `work`, `health`, `goals`, `preferences`,
`history`, `general`) and stored as JSON under
[server/data/memory/](server/data/memory/). Cap is 80 facts per user (rolling).

On the next session, the contents of that file are rendered into the system
prompt under "What you remember about this person", so the persona can
reference it naturally.

## Personas

| Persona | Vibe | Voice |
|---|---|---|
| **Aura** | Daily therapist — calm, reflective, listens before advising | Aoede |
| **Sage** | Mentor — thoughtful, helps you reframe | Charon |
| **Spark** | Best-friend energy — playful, hype | Puck |
| **Coach** | Accountability partner — direct, action-oriented | Orus |
| **Echo** | Quiet listener — reflects back, rarely advises | Kore |

Edit [server/personas.py](server/personas.py) to add your own.

## Notes

- The bot **isn't a clinician**. The Aura persona's system prompt makes it say
  so explicitly if asked for diagnosis or crisis help.
- Memory is local JSON on the server. For production, swap [memory.py](server/memory.py)
  for a real DB and add auth — `user_id` is currently just a localStorage UUID.
- The default Gemini Live model is a preview. Pin a stable model in production.
