"""HTTP API contract tests — covers every endpoint, keyless & deterministic."""

from __future__ import annotations

import memory


def test_root_health(client):  # TC-API-01
    r = client.get("/")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "service" in body


def test_list_personas(client):  # TC-API-02
    r = client.get("/api/personas")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 5
    for p in data:
        assert {"id", "name", "tagline", "accent"} <= p.keys()


def test_memory_new_user_empty(client):  # TC-API-03
    r = client.get("/api/memory/brand-new-user")
    assert r.status_code == 200
    assert r.json() == {"user_id": "brand-new-user", "facts": []}


def test_memory_reflects_stored_fact(client):  # TC-API-04
    memory.remember("api-u1", "Likes masala chai", "preferences")
    facts = client.get("/api/memory/api-u1").json()["facts"]
    assert any(f["fact"] == "Likes masala chai" for f in facts)


def test_memory_delete_clears(client):  # TC-API-05
    memory.remember("api-u2", "Has a dog named Bruno", "general")
    assert client.delete("/api/memory/api-u2").json() == {"ok": True}
    assert client.get("/api/memory/api-u2").json()["facts"] == []


def test_diag_without_key(client):  # TC-API-06
    r = client.get("/api/diag")
    assert r.status_code == 200
    body = r.json()
    assert body["backend"] == "gemini"
    assert body["ok"] is False
    assert "GOOGLE_API_KEY" in body["reason"]
    assert body["image_provider"] == "wikipedia"


def test_connect_requires_key(client):  # TC-API-07
    # No GOOGLE_API_KEY configured -> server refuses to spin up a bot.
    r = client.post("/api/connect", json={})
    assert r.status_code == 500


def test_patch_requires_pc_id(client):  # TC-API-08
    r = client.patch("/api/connect", json={})
    assert r.status_code == 400
