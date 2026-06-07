"""Tiny per-user memory store.

Each user gets a JSON file under data/memory/<user_id>.json holding a rolling list
of "facts" the bot has chosen to remember. Facts are written by the bot calling
the `remember` tool during conversation — not by any post-hoc summarizer — which
keeps the model in control of what's worth keeping.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data" / "memory"
DATA_DIR.mkdir(parents=True, exist_ok=True)

MAX_FACTS = 80  # rolling cap so the system prompt stays small


def _path(user_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", user_id)[:64] or "anon"
    return DATA_DIR / f"{safe}.json"


def load(user_id: str) -> list[dict]:
    p = _path(user_id)
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def remember(user_id: str, fact: str, category: str = "general") -> dict:
    """Append a single fact. Returns the stored entry."""
    fact = fact.strip()
    if not fact:
        raise ValueError("empty fact")

    facts = load(user_id)
    # de-dupe near-identical recent facts (case-insensitive substring)
    fact_lower = fact.lower()
    facts = [f for f in facts if f["fact"].lower() not in fact_lower
             and fact_lower not in f["fact"].lower()]

    entry = {
        "fact": fact,
        "category": category,
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    facts.append(entry)
    facts = facts[-MAX_FACTS:]
    _path(user_id).write_text(json.dumps(facts, indent=2), encoding="utf-8")
    return entry


def forget(user_id: str, query: str) -> int:
    """Remove facts whose text contains `query` (case-insensitive). Returns count removed."""
    facts = load(user_id)
    q = query.lower().strip()
    if not q:
        return 0
    kept = [f for f in facts if q not in f["fact"].lower()]
    removed = len(facts) - len(kept)
    if removed:
        _path(user_id).write_text(json.dumps(kept, indent=2), encoding="utf-8")
    return removed


def render_for_prompt(user_id: str) -> str:
    """Render the memory block that gets injected into the system prompt."""
    facts = load(user_id)
    if not facts:
        return "(You don't know anything about this person yet — this is your first conversation. Get curious.)"

    by_cat: dict[str, list[str]] = {}
    for f in facts:
        by_cat.setdefault(f["category"], []).append(f["fact"])

    lines = []
    for cat, items in by_cat.items():
        lines.append(f"  [{cat}]")
        for item in items:
            lines.append(f"    - {item}")
    return "\n".join(lines)
