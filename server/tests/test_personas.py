"""Unit tests for persona registry."""

from __future__ import annotations

import personas


def test_list_returns_five():  # TC-PER-01
    items = personas.list_personas()
    assert len(items) == 5
    for p in items:
        assert {"id", "name", "tagline", "accent"} <= p.keys()


def test_get_known_persona():  # TC-PER-02
    p = personas.get("sage")
    assert p.id == "sage"
    assert p.name == "Sage"


def test_get_unknown_falls_back_to_aura():  # TC-PER-03
    assert personas.get("does-not-exist").id == "aura"
