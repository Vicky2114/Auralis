"""Shared pytest fixtures.

Keeps the suite deterministic and keyless: every test runs with the Gemini /
OpenAI env vars cleared (so a local .env can't leak in) and with the memory
store redirected to a throwaway temp dir.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Allow `import server, bot, memory, personas` when running from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Strip any real keys / model overrides so tests are deterministic."""
    for var in (
        "GOOGLE_API_KEY",
        "OPENAI_API_KEY",
        "GEMINI_LIVE_MODEL",
        "GEMINI_NATIVE_AUDIO",
        "GOOGLE_CSE_ID",
        "GOOGLE_CSE_KEY",
    ):
        monkeypatch.delenv(var, raising=False)


@pytest.fixture(autouse=True)
def _isolate_memory(tmp_path, monkeypatch):
    """Point the memory store at a temp dir so tests never touch real data."""
    import memory

    d = tmp_path / "memory"
    d.mkdir()
    monkeypatch.setattr(memory, "DATA_DIR", d)
    return d


@pytest.fixture
def client():
    """FastAPI TestClient for the server app (imported lazily — pulls Pipecat)."""
    from fastapi.testclient import TestClient

    import server

    return TestClient(server.app)
