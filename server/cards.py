"""Visual cards the bot can ask the UI to render.

Each fetcher returns a JSON-serialisable dict ready to be sent as an app
message over the WebRTC data channel. The client renders them as floating
cards next to the orb.

All sources here are free and key-less by default (Wikipedia + Open-Meteo);
Google Programmable Search is used when GOOGLE_CSE_ID + key are configured.

Designed to fail soft — if a fetch errors, we return a card with
`kind: "error"` so the bot can still tell the user something went wrong.
"""

from __future__ import annotations

import asyncio
import os
import urllib.parse
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import json as _json

USER_AGENT = "AuraBuddy/0.1 (https://github.com/aura-buddy)"


def _http_json(url: str, *, timeout: float = 8.0) -> dict[str, Any] | None:
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urlopen(req, timeout=timeout) as r:
            return _json.loads(r.read())
    except (HTTPError, URLError, TimeoutError, ValueError):
        return None


# ---------------------------------------------------------------- Wikipedia

def _wikipedia_search_top_title(query: str, lang: str = "en") -> str | None:
    """Find the best-matching Wikipedia page title for a free-form query.

    The summary endpoint requires an exact page title (e.g. 'Taj_Mahal'),
    so a search like 'Taj Mahal Agra' or 'puri bhaji' would 404 if we
    asked for it directly. We use the search API to resolve first.
    """
    q = urllib.parse.quote(query)
    url = (
        f"https://{lang}.wikipedia.org/w/api.php"
        f"?action=query&list=search&srsearch={q}&format=json&srlimit=1"
    )
    data = _http_json(url, timeout=6.0)
    if not data:
        return None
    hits = (data.get("query") or {}).get("search") or []
    if not hits:
        return None
    return hits[0].get("title")


def _wikipedia_summary(title: str, lang: str = "en") -> dict[str, Any] | None:
    """Hit the Wikipedia REST summary API for an exact page title."""
    enc = urllib.parse.quote(title.replace(" ", "_"))
    url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{enc}"
    return _http_json(url)


def _wikipedia_lookup(query: str, lang: str) -> dict[str, Any] | None:
    """Resolve a free-form query to a Wikipedia summary, search-first."""
    # Try the query as-is first (cheap, works for canonical titles like
    # "Taj Mahal" or "Sachin Tendulkar"), then fall back to search.
    direct = _wikipedia_summary(query, lang)
    if direct and (direct.get("thumbnail") or direct.get("originalimage")):
        return direct
    title = _wikipedia_search_top_title(query, lang)
    if not title:
        return direct  # may be None or a thumbnail-less stub
    return _wikipedia_summary(title, lang)


# ---------------------------------------------------------------- Google CSE

def _google_image_search(query: str, *, num: int = 4) -> list[dict[str, Any]]:
    """Google Programmable Search image search.

    Requires GOOGLE_CSE_ID (cx) and GOOGLE_CSE_KEY in the environment.
    Free tier: 100 queries/day.

    Set up at https://programmablesearchengine.google.com/ — turn on
    "Search the entire web" + "Image search" in the engine settings.
    """
    cx = os.environ.get("GOOGLE_CSE_ID")
    key = os.environ.get("GOOGLE_CSE_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not cx or not key:
        return []
    q = urllib.parse.quote(query)
    url = (
        f"https://www.googleapis.com/customsearch/v1"
        f"?q={q}&cx={cx}&key={key}&searchType=image&num={num}&safe=active"
    )
    data = _http_json(url, timeout=10.0)
    if not data:
        return []
    out: list[dict[str, Any]] = []
    for it in data.get("items", []) or []:
        link = it.get("link")
        if not link:
            continue
        out.append({
            "url": link,
            "thumbnail_url": (it.get("image") or {}).get("thumbnailLink") or link,
            "title": it.get("title") or query,
            "source": (it.get("displayLink") or it.get("image", {}).get("contextLink") or ""),
        })
    return out


async def fetch_image_card(query: str, *, lang: str = "en") -> dict[str, Any]:
    """Find an image for `query`. Tries Google CSE first, falls back to Wikipedia."""
    # 1. Google Programmable Search if configured.
    gimg = await asyncio.to_thread(_google_image_search, query)
    if gimg:
        return {
            "kind": "image",
            "query": query,
            "title": query,
            "image_url": gimg[0]["url"],
            "images": gimg,
            "summary": "",
            "source_url": gimg[0].get("source") or "",
            "provider": "google",
        }

    # 2. Wikipedia fallback (works without any keys).
    data = await asyncio.to_thread(_wikipedia_lookup, query, lang)
    if not data and lang != "en":
        data = await asyncio.to_thread(_wikipedia_lookup, query, "en")
    if not data:
        return {
            "kind": "error",
            "query": query,
            "message": f"Couldn't find an image for '{query}'.",
        }

    thumb = (data.get("originalimage") or data.get("thumbnail") or {}).get("source")
    if not thumb:
        return {
            "kind": "error",
            "query": query,
            "message": f"No image available for '{query}'.",
        }

    return {
        "kind": "image",
        "query": query,
        "title": data.get("title") or query,
        "image_url": thumb,
        "images": [{"url": thumb, "thumbnail_url": thumb,
                    "title": data.get("title") or query,
                    "source": "Wikipedia"}],
        "summary": (data.get("extract") or "").strip(),
        "source_url": (data.get("content_urls", {}).get("desktop", {}) or {}).get("page")
            or f"https://{lang}.wikipedia.org/wiki/{urllib.parse.quote(query)}",
        "provider": "wikipedia",
    }


# ---------------------------------------------------------------- Weather

_WMO: dict[int, tuple[str, str]] = {
    0: ("Clear sky", "☀️"),
    1: ("Mostly clear", "🌤️"),
    2: ("Partly cloudy", "⛅"),
    3: ("Overcast", "☁️"),
    45: ("Fog", "🌫️"),
    48: ("Freezing fog", "🌫️"),
    51: ("Light drizzle", "🌦️"),
    53: ("Drizzle", "🌦️"),
    55: ("Heavy drizzle", "🌧️"),
    61: ("Light rain", "🌦️"),
    63: ("Rain", "🌧️"),
    65: ("Heavy rain", "🌧️"),
    71: ("Light snow", "🌨️"),
    73: ("Snow", "🌨️"),
    75: ("Heavy snow", "❄️"),
    80: ("Rain showers", "🌦️"),
    81: ("Rain showers", "🌧️"),
    82: ("Heavy showers", "⛈️"),
    95: ("Thunderstorm", "⛈️"),
    96: ("Thunderstorm w/ hail", "⛈️"),
    99: ("Severe thunderstorm", "⛈️"),
}


def _geocode(city: str) -> tuple[float, float, str, str] | None:
    """Resolve a city name to (lat, lon, name, country) via Open-Meteo."""
    q = urllib.parse.quote(city)
    url = f"https://geocoding-api.open-meteo.com/v1/search?name={q}&count=1&language=en&format=json"
    data = _http_json(url)
    if not data or not data.get("results"):
        return None
    r = data["results"][0]
    return float(r["latitude"]), float(r["longitude"]), r["name"], r.get("country", "")


async def fetch_weather_card(city: str) -> dict[str, Any]:
    geo = await asyncio.to_thread(_geocode, city)
    if not geo:
        return {"kind": "error", "query": city, "message": f"Couldn't find '{city}' on the map."}

    lat, lon, name, country = geo
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m"
        "&timezone=auto"
    )
    data = await asyncio.to_thread(_http_json, url)
    cur = (data or {}).get("current") or {}
    if not cur:
        return {"kind": "error", "query": city, "message": "Weather service didn't respond."}

    code = int(cur.get("weather_code") or 0)
    label, emoji = _WMO.get(code, ("Unknown", "❓"))
    return {
        "kind": "weather",
        "city": name,
        "country": country,
        "temp_c": round(float(cur.get("temperature_2m") or 0), 1),
        "humidity": cur.get("relative_humidity_2m"),
        "wind_kmh": round(float(cur.get("wind_speed_10m") or 0), 1),
        "condition": label,
        "emoji": emoji,
    }
