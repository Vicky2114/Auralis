"""FastAPI signaling server.

Exposes:
  GET    /api/personas           -> list available personas (id, name, tagline, accent)
  GET    /api/memory/{uid}       -> dump memory facts for a user
  DELETE /api/memory/{uid}       -> clear all memory for a user
  POST   /api/connect            -> WebRTC offer; spawns a Pipecat bot per peer
  PATCH  /api/connect            -> ICE candidate trickle for an existing pc
  GET    /                       -> health check

In dev, run alongside the Vite client (CORS is permissive).
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from pipecat.transports.smallwebrtc.connection import IceServer, SmallWebRTCConnection
from pipecat.transports.smallwebrtc.request_handler import (
    ConnectionMode,
    IceCandidate,
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)

import bot as bot_module
import memory
import personas

# override=True so the project's .env wins over any stray machine/user-level
# env vars (e.g. a leftover GOOGLE_API_KEY in the OS environment shadowing it).
load_dotenv(override=True)


def _ice_servers() -> list[IceServer]:
    """STUN/TURN for WebRTC NAT traversal.

    On localhost no ICE servers are needed. Across the public internet you need
    STUN (cheap, just discovers your public IP) and almost always TURN (relays
    media when peers are behind strict NATs). Configure via env:

        STUN_URL          (default: Google's public STUN)
        TURN_URL          e.g. turn:turn.example.com:3478
        TURN_USERNAME
        TURN_CREDENTIAL
    """
    servers: list[IceServer] = []
    stun = os.environ.get("STUN_URL", "stun:stun.l.google.com:19302").strip()
    if stun:
        servers.append(IceServer(urls=stun))
    turn = os.environ.get("TURN_URL", "").strip()
    if turn:
        servers.append(
            IceServer(
                urls=turn,
                username=os.environ.get("TURN_USERNAME") or None,
                credential=os.environ.get("TURN_CREDENTIAL") or None,
            )
        )
    logger.info(f"ICE servers configured: {[s.urls for s in servers]}")
    return servers


webrtc_handler = SmallWebRTCRequestHandler(
    connection_mode=ConnectionMode.MULTIPLE,
    ice_servers=_ice_servers(),
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    logger.info("Shutting down — closing peer connections")
    await webrtc_handler.close()


app = FastAPI(lifespan=lifespan)

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
    if not os.environ.get("GOOGLE_API_KEY"):
        raise HTTPException(500, "GOOGLE_API_KEY not configured on server")

    body = await req.json()
    pipecat_request = SmallWebRTCRequest.from_dict(body)
    data = pipecat_request.request_data or {}
    user_id = str(data.get("user_id") or "anon")
    persona_id = str(data.get("persona_id") or "aura")

    async def on_new_connection(pc: SmallWebRTCConnection) -> None:
        # Spawn the bot once the connection is initialized. It will run for
        # the lifetime of the peer connection.
        asyncio.create_task(bot_module.run_bot(pc, user_id, persona_id))

    answer = await webrtc_handler.handle_web_request(pipecat_request, on_new_connection)
    if answer is None:
        raise HTTPException(500, "No answer produced for offer")
    return answer


@app.patch("/api/connect")
async def patch_connection(req: Request) -> dict[str, str]:
    body = await req.json()
    pc_id = body.get("pc_id")
    if not pc_id:
        raise HTTPException(400, "pc_id required")
    candidates = [
        IceCandidate(
            candidate=c["candidate"],
            sdp_mid=c.get("sdp_mid") or c.get("sdpMid"),
            sdp_mline_index=c.get("sdp_mline_index") or c.get("sdpMLineIndex") or 0,
        )
        for c in body.get("candidates", [])
    ]
    await webrtc_handler.handle_patch_request(
        SmallWebRTCPatchRequest(pc_id=pc_id, candidates=candidates)
    )
    return {"ok": "true"}


def main() -> None:
    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
