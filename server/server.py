"""FastAPI server.

Exposes:
  GET    /api/personas           -> list available personas (id, name, tagline, accent)
  GET    /api/memory/{uid}       -> dump memory facts for a user
  DELETE /api/memory/{uid}       -> clear all memory for a user
  POST   /api/connect            -> create a Daily room + token, spawn a bot in it
  GET    /                       -> health check

Uses Daily as the WebRTC transport: Daily hosts the media (TURN included), so
this server only creates rooms and orchestrates the bot. In dev, run alongside
the Vite client (CORS is permissive).
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import aiohttp
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

# NOTE: pipecat.transports.daily.utils is imported lazily inside connect() —
# it pulls daily-python (no Windows wheel), so a top-level import would break
# module load (and tests) on Windows dev machines.

import bot as bot_module
import memory
import personas

# override=True so the project's .env wins over any stray machine/user-level
# env vars (e.g. a leftover GOOGLE_API_KEY in the OS environment shadowing it).
load_dotenv(override=True)

DAILY_API_KEY = os.environ.get("DAILY_API_KEY", "")
DAILY_API_URL = os.environ.get("DAILY_API_URL", "https://api.daily.co/v1")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten for prod
    allow_methods=["*"],
    allow_headers=["*"],
)


# We don't declare a Pydantic model for the connect body — the Pipecat client
# sends camelCase `requestData`, while older clients send snake_case
# `request_data`. SmallWebRTCRequest.from_dict accepts both.


@app.get("/")
async def root() -> dict[str, str]:
    return {"status": "ok", "service": "aura-buddy"}


@app.get("/api/diag")
async def diag() -> dict[str, Any]:
    """Quick health-check for the Gemini Live backend."""
    out: dict[str, Any] = {"backend": "gemini"}
    out.update(_diag_gemini())

    # Always show what the image-card fetcher will use.
    out["image_provider"] = (
        "google_cse"
        if os.environ.get("GOOGLE_CSE_ID")
        and (os.environ.get("GOOGLE_CSE_KEY") or os.environ.get("GOOGLE_API_KEY"))
        else "wikipedia"
    )
    return out


def _diag_gemini() -> dict[str, Any]:
    import json as _json
    import urllib.error
    import urllib.request

    key = os.environ.get("GOOGLE_API_KEY")
    if not key:
        return {"ok": False, "reason": "GOOGLE_API_KEY missing in .env"}
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={key}"
        with urllib.request.urlopen(url, timeout=10) as r:
            data = _json.loads(r.read())
        models = [
            m["name"]
            for m in data.get("models", [])
            if "live" in m["name"].lower() or "native-audio" in m["name"].lower()
        ]
        from bot import resolve_gemini_model

        configured_model, model_source = resolve_gemini_model()
        return {
            "ok": True,
            "key_prefix": key[:6] + "…",
            "configured_model": configured_model,
            "configured_model_source": model_source,
            "live_models_available_to_your_key": sorted(models),
        }
    except urllib.error.HTTPError as e:
        return {"ok": False, "reason": f"Google API rejected key: {e.code} {e.reason}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "reason": str(e)}


@app.get("/api/personas")
async def list_personas() -> list[dict[str, Any]]:
    return personas.list_personas()


@app.get("/api/memory/{user_id}")
async def get_memory(user_id: str) -> dict[str, Any]:
    return {"user_id": user_id, "facts": memory.load(user_id)}


@app.delete("/api/memory/{user_id}")
async def clear_memory(user_id: str) -> dict[str, Any]:
    p = memory._path(user_id)  # noqa: SLF001
    if p.exists():
        p.unlink()
    return {"ok": True}


@app.post("/api/connect")
async def connect(req: Request) -> dict[str, Any]:
    """Create a short-lived Daily room + tokens, spawn the bot, return room+token.

    The Pipecat JS client (DailyTransport) posts here and expects
    {"room_url": ..., "token": ...} so it can join the same room as the bot.
    """
    if not os.environ.get("GOOGLE_API_KEY"):
        raise HTTPException(500, "GOOGLE_API_KEY not configured on server")
    if not DAILY_API_KEY:
        raise HTTPException(500, "DAILY_API_KEY not configured on server")

    from pipecat.transports.daily.utils import (
        DailyRESTHelper,
        DailyRoomParams,
        DailyRoomProperties,
    )

    body = await req.json()
    data = body.get("requestData") or body.get("request_data") or {}
    user_id = str(data.get("user_id") or "anon")
    persona_id = str(data.get("persona_id") or "aura")

    async with aiohttp.ClientSession() as session:
        helper = DailyRESTHelper(
            daily_api_key=DAILY_API_KEY,
            daily_api_url=DAILY_API_URL,
            aiohttp_session=session,
        )
        # Ephemeral room: auto-expires in 1h and ejects participants then.
        room = await helper.create_room(
            DailyRoomParams(
                properties=DailyRoomProperties(
                    exp=time.time() + 60 * 60,
                    eject_at_room_exp=True,
                    enable_prejoin_ui=False,
                )
            )
        )
        bot_token = await helper.get_token(room.url, expiry_time=60 * 60, owner=True)
        client_token = await helper.get_token(room.url, expiry_time=60 * 60, owner=False)

    # Spawn the bot into the room; it runs for the lifetime of the call.
    asyncio.create_task(bot_module.run_bot(room.url, bot_token, user_id, persona_id))

    return {"room_url": room.url, "token": client_token}


def main() -> None:
    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
