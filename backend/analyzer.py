"""
analyzer.py - Image analysis engine for Smart Photo Sorter.
Handles EXIF extraction, GPS parsing, blur detection, and perceptual hashing.
"""
import os
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Optional

import cv2
import imagehash
import numpy as np
from PIL import Image, ExifTags, UnidentifiedImageError

from predict import predict_blur, is_available as cnn_available

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp", ".heic", ".heif"}

# Use CNN model if available, otherwise fall back to Laplacian
_USE_CNN = cnn_available()

def is_image(path: str) -> bool:
    return Path(path).suffix.lower() in SUPPORTED_EXTENSIONS

def get_exif_data(image: Image.Image) -> dict:
    """Extract raw EXIF tag dictionary from a PIL image."""
    exif_data = {}
    try:
        raw = image._getexif()
        if raw:
            for tag_id, value in raw.items():
                tag = ExifTags.TAGS.get(tag_id, tag_id)
                exif_data[tag] = value
    except Exception:
        pass
    return exif_data

def parse_gps(exif_data: dict) -> Optional[tuple[float, float]]:
    """Parse GPSInfo from EXIF and return (lat, lon) or None."""
    gps_info = exif_data.get("GPSInfo")
    if not gps_info:
        return None
    try:
        gps_tags = {ExifTags.GPSTAGS.get(k, k): v for k, v in gps_info.items()}

        def to_decimal(values, ref):
            d = float(values[0])
            m = float(values[1])
            s = float(values[2])
            decimal = d + m / 60 + s / 3600
            if ref in ("S", "W"):
                decimal = -decimal
            return decimal

        lat = to_decimal(gps_tags["GPSLatitude"], gps_tags.get("GPSLatitudeRef", "N"))
        lon = to_decimal(gps_tags["GPSLongitude"], gps_tags.get("GPSLongitudeRef", "E"))
        return round(lat, 6), round(lon, 6)
    except Exception:
        return None

def parse_datetime(exif_data: dict, fallback_path: str) -> datetime:
    """Extract datetime from EXIF, fall back to file modification time."""
    for key in ("DateTimeOriginal", "DateTimeDigitized", "DateTime"):
        raw = exif_data.get(key)
        if raw:
            try:
                return datetime.strptime(raw.split(".")[0], "%Y:%m:%d %H:%M:%S")
            except ValueError:
                pass
    # Fallback to file modification time
    return datetime.fromtimestamp(os.path.getmtime(fallback_path))

def compute_blur_score(image_path: str) -> float:
    """
    Compute sharpness using Laplacian variance (OpenCV).
    Higher = sharper. Values below ~100 are typically blurry.
    """
    try:
        img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
        if img is None:
            return 0.0
        score = float(cv2.Laplacian(img, cv2.CV_64F).var())
        return round(score, 2)
    except Exception:
        return 0.0

def compute_phash(image_path: str) -> Optional[str]:
    """Compute perceptual hash (dHash) for duplicate detection."""
    try:
        with Image.open(image_path) as img:
            return str(imagehash.dhash(img))
    except Exception:
        return None

def compute_file_hash(image_path: str) -> str:
    """Compute SHA-256 hash for exact duplicate detection."""
    sha256 = hashlib.sha256()
    try:
        with open(image_path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                sha256.update(chunk)
    except Exception:
        pass
    return sha256.hexdigest()

def analyze_image(image_path: str) -> dict:
    """
    Full analysis of a single image file.
    Returns a dict with all metadata, scores, and hashes.
    """
    result = {
        "path": image_path,
        "filename": os.path.basename(image_path),
        "size_bytes": 0,
        "date_taken": None,
        "date_taken_str": None,
        "gps": None,
        "blur_score": 0.0,
        "is_blurry": False,
        "phash": None,
        "file_hash": None,
        "error": None,
    }

    try:
        result["size_bytes"] = os.path.getsize(image_path)
        result["file_hash"] = compute_file_hash(image_path)

        with Image.open(image_path) as img:
            img.verify()  # Check integrity

        with Image.open(image_path) as img:
            exif = get_exif_data(img)
            dt = parse_datetime(exif, image_path)
            result["date_taken"] = dt.isoformat()
            result["date_taken_str"] = dt.strftime("%Y-%m-%d")
            gps = parse_gps(exif)
            result["gps"] = {"lat": gps[0], "lon": gps[1]} if gps else None

        result["blur_score"] = compute_blur_score(image_path)
        if _USE_CNN:
            is_blurry, confidence = predict_blur(image_path)
            result["is_blurry"] = is_blurry
            result["blur_score"] = round(confidence * 100, 2)  # store confidence as score
        else:
            result["is_blurry"] = result["blur_score"] < 80.0
        result["phash"] = compute_phash(image_path)

    except UnidentifiedImageError:
        result["error"] = "Not a valid image file"
    except Exception as e:
        result["error"] = str(e)

    return result

def group_duplicates(photos: list[dict], hamming_threshold: int = 8) -> list[list[str]]:
    """
    Group photos into duplicate clusters using perceptual hash.
    Returns list of groups, each group is a list of file paths.
    Only groups with 2+ photos are returned.
    """
    # First pass: exact file hash groups
    exact: dict[str, list[str]] = {}
    for p in photos:
        if p.get("file_hash"):
            exact.setdefault(p["file_hash"], []).append(p["path"])

    exact_groups = [paths for paths in exact.values() if len(paths) > 1]
    already_grouped = {path for group in exact_groups for path in group}

    # Second pass: perceptual hash groups (near-duplicates / bursts)
    remaining = [p for p in photos if p["path"] not in already_grouped and p.get("phash")]
    phash_groups: list[list[str]] = []
    visited = set()

    for i, photo in enumerate(remaining):
        if photo["path"] in visited:
            continue
        group = [photo["path"]]
        visited.add(photo["path"])
        h1 = imagehash.hex_to_hash(photo["phash"])
        for j, other in enumerate(remaining):
            if i == j or other["path"] in visited:
                continue
            h2 = imagehash.hex_to_hash(other["phash"])
            if abs(h1 - h2) <= hamming_threshold:
                group.append(other["path"])
                visited.add(other["path"])
        if len(group) > 1:
            phash_groups.append(group)

    return exact_groups + phash_groups

def cluster_by_event(photos: list[dict], time_gap_hours: int = 24) -> list[dict]:
    """
    Cluster photos into events based on time proximity and location.
    Returns list of clusters with metadata summaries.
    """
    # Filter out errored photos and sort by date
    valid = [p for p in photos if p.get("date_taken")]
    valid.sort(key=lambda x: x["date_taken"])

    if not valid:
        return []

    clusters = []
    current_cluster = [valid[0]]

    for photo in valid[1:]:
        prev_dt = datetime.fromisoformat(current_cluster[-1]["date_taken"])
        curr_dt = datetime.fromisoformat(photo["date_taken"])
        gap = (curr_dt - prev_dt).total_seconds() / 3600

        if gap <= time_gap_hours:
            current_cluster.append(photo)
        else:
            clusters.append(_summarize_cluster(current_cluster))
            current_cluster = [photo]

    if current_cluster:
        clusters.append(_summarize_cluster(current_cluster))

    return clusters

def _summarize_cluster(photos: list[dict]) -> dict:
    """Build a summary dict for a cluster of photos."""
    dates = sorted(set(p["date_taken_str"] for p in photos if p.get("date_taken_str")))
    gps_list = [p["gps"] for p in photos if p.get("gps")]

    avg_lat = round(sum(g["lat"] for g in gps_list) / len(gps_list), 6) if gps_list else None
    avg_lon = round(sum(g["lon"] for g in gps_list) / len(gps_list), 6) if gps_list else None

    return {
        "photo_count": len(photos),
        "date_range": {"start": dates[0], "end": dates[-1]} if dates else None,
        "avg_gps": {"lat": avg_lat, "lon": avg_lon} if avg_lat is not None else None,
        "has_gps": avg_lat is not None,
        "photos": photos,
        "event_name": None,      # filled by Gemini or fallback
        "location_label": None,  # filled by geocoder
    }
