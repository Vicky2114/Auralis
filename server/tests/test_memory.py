"""Unit tests for the per-user memory store."""

from __future__ import annotations

import pytest

import memory


def test_remember_returns_entry():  # TC-MEM-01
    e = memory.remember("u", "Plays guitar", "preferences")
    assert e["fact"] == "Plays guitar"
    assert e["category"] == "preferences"
    assert "ts" in e
    assert memory.load("u") == [e]


def test_remember_empty_raises():  # TC-MEM-02
    with pytest.raises(ValueError):
        memory.remember("u", "   ", "general")


def test_remember_dedupes_substring():  # TC-MEM-03
    memory.remember("u", "Has a daughter named Mira", "relationships")
    memory.remember("u", "daughter named Mira", "relationships")
    facts = memory.load("u")
    assert len(facts) == 1
    assert facts[0]["fact"] == "daughter named Mira"


def test_rolling_cap_keeps_newest():  # TC-MEM-04
    # Use non-overlapping strings so the substring de-dupe doesn't interfere.
    for i in range(90):
        memory.remember("u", f"fact number {i:03d} stored", "general")
    facts = memory.load("u")
    assert len(facts) == memory.MAX_FACTS  # 80
    assert facts[-1]["fact"] == "fact number 089 stored"
    assert facts[0]["fact"] == "fact number 010 stored"


def test_forget_case_insensitive():  # TC-MEM-05
    memory.remember("u", "Loves Cricket", "preferences")
    memory.remember("u", "Hates traffic", "general")
    removed = memory.forget("u", "cricket")
    assert removed == 1
    assert all("cricket" not in f["fact"].lower() for f in memory.load("u"))


def test_forget_empty_query_noop():  # TC-MEM-06
    memory.remember("u", "Some fact", "general")
    assert memory.forget("u", "   ") == 0
    assert len(memory.load("u")) == 1


def test_load_missing_user():  # TC-MEM-07
    assert memory.load("nobody-here") == []


def test_load_corrupt_json_is_resilient():  # TC-MEM-08
    memory._path("corrupt").write_text("{not valid json", encoding="utf-8")
    assert memory.load("corrupt") == []


def test_render_empty_is_first_conversation():  # TC-MEM-09
    out = memory.render_for_prompt("fresh-user")
    assert "first conversation" in out.lower()


def test_render_groups_by_category():  # TC-MEM-10
    memory.remember("u", "Works as a teacher", "work")
    memory.remember("u", "Likes tea", "preferences")
    out = memory.render_for_prompt("u")
    assert "[work]" in out
    assert "[preferences]" in out
    assert "Works as a teacher" in out


def test_path_sanitizes_unsafe_ids():  # TC-MEM-11
    p = memory._path("../../etc/passwd")
    assert "/" not in p.name
    assert "\\" not in p.name
    assert ".." not in p.name
