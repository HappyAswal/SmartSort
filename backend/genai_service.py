"""
genai_service.py - Gemini API integration for folder naming and travel log generation.
Uses the google-genai SDK >= 1.0.0
"""
from __future__ import annotations

import json
import re
import time
from typing import Optional

try:
    from google import genai
    _GENAI_AVAILABLE = True
except ImportError:
    _GENAI_AVAILABLE = False

# gemini-2.5-flash is available on free tier globally
_DEFAULT_MODEL = "gemini-2.5-flash"


def _get_client(api_key: str):
    if not _GENAI_AVAILABLE:
        raise RuntimeError("google-genai package is not installed.")
    return genai.Client(api_key=api_key)


def _generate_with_retry(client, prompt: str, retries: int = 3) -> str:
    """Call Gemini with automatic retry on 429 rate-limit errors."""
    last_err = None
    for attempt in range(retries):
        try:
            response = client.models.generate_content(
                model=_DEFAULT_MODEL,
                contents=prompt,
            )
            return response.text.strip()
        except Exception as e:
            last_err = e
            msg = str(e)
            if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                match = re.search(r"retry[^\d]*(\d+)", msg, re.IGNORECASE)
                wait = int(match.group(1)) + 2 if match else (20 * (attempt + 1))
                time.sleep(wait)
            else:
                raise
    raise last_err


def generate_event_names(clusters: list[dict], api_key: str) -> list[str]:
    """
    Given a list of cluster metadata dicts, ask Gemini to generate
    a creative, descriptive folder name for each cluster.
    Returns a list of name strings, one per cluster, in the same order.
    """
    client = _get_client(api_key)

    cluster_summaries = []
    for i, c in enumerate(clusters):
        date_info = ""
        if c.get("date_range"):
            start = c["date_range"].get("start", "")
            end = c["date_range"].get("end", "")
            date_info = start if start == end else f"{start} to {end}"
        location = c.get("location_label") or "Unknown Location"
        count = c.get("photo_count", 0)
        cluster_summaries.append(
            f"Event {i + 1}: {count} photos, Location: {location}, Dates: {date_info}"
        )

    prompt = (
        "You are a creative travel photographer's assistant. "
        "Based on the following photo cluster summaries, generate a short, evocative, "
        "and descriptive folder name for each event. "
        "The name should sound like a memorable trip title (e.g., 'Golden Temple Amritsar – Diwali Visit' "
        "or 'Monsoon Drive Through Coorg'). "
        "Return ONLY a JSON array of strings, one name per event, in the same order as the input. "
        "Do not include numbering, explanations, or markdown. Just the JSON array.\n\n"
        "Events:\n" + "\n".join(cluster_summaries)
    )

    raw = _generate_with_retry(client, prompt)

    # Strip markdown code fences if present
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(lines[1:-1]) if len(lines) > 2 else raw

    try:
        names = json.loads(raw)
        if isinstance(names, list):
            return [sanitize_folder_name(str(n)) for n in names]
    except json.JSONDecodeError:
        pass

    lines = [ln.strip().strip('"').strip("'").strip(",") for ln in raw.splitlines() if ln.strip()]
    return [sanitize_folder_name(ln) for ln in lines] if lines else _fallback_names(clusters)


def generate_travelogue(clusters: list[dict], destination: str, api_key: str) -> str:
    """
    Generate a beautifully written Markdown travel log summarizing the entire trip.
    Returns the Markdown string.
    """
    client = _get_client(api_key)

    folder_summaries = []
    for c in clusters:
        name = c.get("event_name") or "Unnamed Event"
        date_info = ""
        if c.get("date_range"):
            start = c["date_range"].get("start", "")
            end = c["date_range"].get("end", "")
            date_info = start if start == end else f"{start} to {end}"
        location = c.get("location_label") or ""
        count = c.get("photo_count", 0)
        folder_summaries.append(f"- **{name}**: {count} photos, {location}, {date_info}")

    prompt = (
        "You are a gifted travel writer. Based on the following list of photo albums from a trip, "
        "write a beautiful, flowing, first-person travel journal in Markdown format. "
        "Include vivid descriptions of each location, weave in the dates naturally, "
        "and give the whole story a warm, nostalgic tone. "
        "Start with a poetic title (# heading), include section headings for each event (## heading), "
        "and end with a short reflective conclusion.\n\n"
        "Photo Albums:\n" + "\n".join(folder_summaries)
    )

    return _generate_with_retry(client, prompt)


def sanitize_folder_name(name: str, max_length: int = 60) -> str:
    """Remove filesystem-unsafe characters from a folder name."""
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name)
    name = name.strip(". ")
    return name[:max_length] if len(name) > max_length else name


def _fallback_names(clusters: list[dict]) -> list[str]:
    """Generate simple fallback names when Gemini is unavailable."""
    names = []
    for c in clusters:
        location = c.get("location_label") or "Photos"
        date = c.get("date_range", {}).get("start", "") if c.get("date_range") else ""
        names.append(sanitize_folder_name(f"{location} {date}".strip()))
    return names
