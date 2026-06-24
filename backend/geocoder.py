"""
geocoder.py - Thread-safe reverse geocoding with local JSON cache.
Uses OpenStreetMap Nominatim via geopy (no API key required).
"""
import json
import os
import threading
import time
from pathlib import Path
from typing import Optional

from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError

CACHE_FILE = Path(__file__).parent / "geocache.json"
CACHE_LOCK = threading.Lock()
# Round to 2 decimal places for cache (~1km precision)
CACHE_PRECISION = 2

_geolocator = Nominatim(user_agent="smart-photo-sorter/1.0", timeout=10)


def _load_cache() -> dict:
    if CACHE_FILE.exists():
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


def _save_cache(cache: dict) -> None:
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2, ensure_ascii=False)
    except IOError:
        pass


def _cache_key(lat: float, lon: float) -> str:
    return f"{round(lat, CACHE_PRECISION)},{round(lon, CACHE_PRECISION)}"


def reverse_geocode(lat: float, lon: float, retries: int = 3) -> Optional[str]:
    """
    Reverse geocode (lat, lon) to a human-readable location string.
    Results are cached in geocache.json to avoid redundant API calls.
    Returns a string like "Vrindavan, Mathura, Uttar Pradesh, India" or None.
    """
    key = _cache_key(lat, lon)

    with CACHE_LOCK:
        cache = _load_cache()
        if key in cache:
            return cache[key]

    # Not cached — call Nominatim
    location_str = None
    for attempt in range(retries):
        try:
            location = _geolocator.reverse((lat, lon), language="en", exactly_one=True)
            if location:
                addr = location.raw.get("address", {})
                # Build a concise label: city/town/village + state + country
                parts = []
                for field in ("village", "town", "city", "suburb", "county", "state_district", "state", "country"):
                    val = addr.get(field)
                    if val and val not in parts:
                        parts.append(val)
                        if len(parts) == 3:
                            break
                location_str = ", ".join(parts) if parts else location.address
            break
        except GeocoderTimedOut:
            if attempt < retries - 1:
                time.sleep(1.5)
        except GeocoderServiceError:
            break
        except Exception:
            break

    with CACHE_LOCK:
        cache = _load_cache()
        cache[key] = location_str
        _save_cache(cache)

    return location_str


def enrich_clusters_with_location(clusters: list[dict]) -> list[dict]:
    """
    For each cluster that has GPS data, reverse geocode and set location_label.
    """
    for cluster in clusters:
        gps = cluster.get("avg_gps")
        if gps and gps.get("lat") is not None:
            label = reverse_geocode(gps["lat"], gps["lon"])
            cluster["location_label"] = label
        else:
            cluster["location_label"] = None
    return clusters
