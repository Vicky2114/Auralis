"""Unit tests for Gemini model resolution and tool schema (no network)."""

from __future__ import annotations

import pytest

import bot


def test_explicit_model_wins(monkeypatch):  # TC-MOD-01
    monkeypatch.setenv("GEMINI_LIVE_MODEL", "models/custom-xyz")
    monkeypatch.setenv("GEMINI_NATIVE_AUDIO", "false")  # should be ignored
    model, source = bot.resolve_gemini_model()
    assert model == "models/custom-xyz"
    assert source == "GEMINI_LIVE_MODEL"


def test_default_is_native_audio(monkeypatch):  # TC-MOD-02
    # Both vars cleared by the autouse fixture -> default native-audio.
    model, source = bot.resolve_gemini_model()
    assert model == bot.GEMINI_DEFAULT_NATIVE_AUDIO
    assert "true" in source


def test_native_audio_true(monkeypatch):  # TC-MOD-03
    monkeypatch.setenv("GEMINI_NATIVE_AUDIO", "true")
    model, _ = bot.resolve_gemini_model()
    assert model == bot.GEMINI_DEFAULT_NATIVE_AUDIO


def test_native_audio_false(monkeypatch):  # TC-MOD-04
    monkeypatch.setenv("GEMINI_NATIVE_AUDIO", "false")
    model, source = bot.resolve_gemini_model()
    assert model == bot.GEMINI_DEFAULT_LIVE
    assert "false" in source


@pytest.mark.parametrize(
    "value,expected",
    [
        ("1", True), ("true", True), ("YES", True), ("on", True),
        ("y", True), ("t", True), ("True", True),
        ("0", False), ("false", False), ("", False), ("no", False),
        ("off", False), (None, False),
    ],
)
def test_truthy(value, expected):  # TC-MOD-05
    assert bot._truthy(value) is expected


def test_build_tools_has_memory_and_search():  # TC-MOD-06
    from pipecat.adapters.schemas.tools_schema import AdapterType

    tools = bot.build_tools()
    standard_names = {t.name for t in tools.standard_tools}
    assert {"remember", "forget"} <= standard_names
    # Gemini's native google_search grounding tool is registered.
    assert AdapterType.GEMINI in tools.custom_tools
    assert any("google_search" in t for t in tools.custom_tools[AdapterType.GEMINI])
