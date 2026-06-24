"""
main.py - FastAPI entry point for Smart Photo Sorter backend.

Endpoints:
  POST /api/scan              - Scan a source directory
  POST /api/sort              - Execute copy/move of files
  GET  /api/file              - Stream an image file securely
  POST /api/generate-names    - Generate AI event names via Gemini
  POST /api/generate-travelogue - Generate AI travel log via Gemini
"""
from __future__ import annotations

import io
import os
import shutil
from functools import lru_cache
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, Response
from pydantic import BaseModel

from analyzer import analyze_image, group_duplicates, cluster_by_event, is_image
from geocoder import enrich_clusters_with_location
from genai_service import generate_event_names, generate_travelogue, _fallback_names

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(title="Smart Photo Sorter API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BLUR_THRESHOLD = 80.0  # Laplacian variance threshold

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ScanRequest(BaseModel):
    source_dir: str
    time_gap_hours: int = 24


class SortRequest(BaseModel):
    source_dir: str
    destination_dir: str
    clusters: list[dict]
    mode: str = "copy"  # "copy" or "move"
    dry_run: bool = False


class GenerateNamesRequest(BaseModel):
    clusters: list[dict]
    api_key: str


class GenerateTravelogueRequest(BaseModel):
    clusters: list[dict]
    destination_dir: str
    api_key: str


class DeleteFilesRequest(BaseModel):
    paths: list[str]


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _serialize_cluster(c: dict) -> dict:
    """Return a cluster dict safe for JSON serialisation (remove full photo list for payload size)."""
    return {
        "photo_count": c["photo_count"],
        "date_range": c["date_range"],
        "avg_gps": c["avg_gps"],
        "has_gps": c["has_gps"],
        "location_label": c.get("location_label"),
        "event_name": c.get("event_name"),
        "photos": [
            {
                "path": p["path"],
                "filename": p["filename"],
                "date_taken_str": p.get("date_taken_str"),
                "blur_score": p.get("blur_score"),
                "is_blurry": p.get("is_blurry"),
                "size_bytes": p.get("size_bytes"),
                "error": p.get("error"),
            }
            for p in c.get("photos", [])
        ],
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/scan")
async def scan(req: ScanRequest):
    source = Path(req.source_dir)
    if not source.exists():
        raise HTTPException(status_code=400, detail=f"Source directory does not exist: {req.source_dir}")
    if not source.is_dir():
        raise HTTPException(status_code=400, detail=f"Path is not a directory: {req.source_dir}")

    # Gather all image files (recursive)
    image_paths = []
    for root, _, files in os.walk(source):
        for fname in files:
            fpath = os.path.join(root, fname)
            if is_image(fpath):
                image_paths.append(fpath)

    if not image_paths:
        return {"total_scanned": 0, "clusters": [], "duplicates": [], "blurry": []}

    # Analyze each image
    photos = []
    for p in image_paths:
        photos.append(analyze_image(p))

    # Detect duplicates
    duplicate_groups = group_duplicates(photos)
    duplicate_paths = {path for group in duplicate_groups for path in group}

    # Blurry photos
    blurry_photos = [
        {"path": p["path"], "filename": p["filename"], "blur_score": p["blur_score"]}
        for p in photos
        if p.get("is_blurry") and not p.get("error")
    ]

    # Cluster into events
    clusters = cluster_by_event(photos, time_gap_hours=req.time_gap_hours)

    # Enrich with geocoding
    clusters = enrich_clusters_with_location(clusters)

    # Generate fallback event names
    for c in clusters:
        if not c.get("event_name"):
            location = c.get("location_label") or "Unknown Location"
            date = c.get("date_range", {}).get("start", "") if c.get("date_range") else ""
            c["event_name"] = f"{location} – {date}".strip(" –")

    # Serialise duplicate groups for JSON
    dup_groups_serialised = [
        [{"path": p, "filename": os.path.basename(p)} for p in group]
        for group in duplicate_groups
    ]

    return {
        "total_scanned": len(image_paths),
        "total_valid": len([p for p in photos if not p.get("error")]),
        "clusters": [_serialize_cluster(c) for c in clusters],
        "duplicates": dup_groups_serialised,
        "blurry": blurry_photos,
    }


@app.post("/api/sort")
async def sort_photos(req: SortRequest):
    dest_root = Path(req.destination_dir)

    if not req.dry_run:
        dest_root.mkdir(parents=True, exist_ok=True)

    operations = []
    errors = []

    for cluster in req.clusters:
        event_name = cluster.get("event_name") or "Unsorted"
        date_start = (cluster.get("date_range") or {}).get("start", "unknown-date")

        folder = dest_root / event_name / date_start
        if not req.dry_run:
            folder.mkdir(parents=True, exist_ok=True)

        for photo in cluster.get("photos", []):
            src = Path(photo["path"])
            if not src.exists():
                errors.append({"path": str(src), "error": "Source file not found"})
                continue

            dst = folder / src.name
            # Handle name collisions
            counter = 1
            while dst.exists() and not req.dry_run:
                stem = src.stem
                dst = folder / f"{stem}_{counter}{src.suffix}"
                counter += 1

            operations.append({
                "src": str(src),
                "dst": str(dst),
                "mode": req.mode,
            })

            if not req.dry_run:
                try:
                    if req.mode == "move":
                        shutil.move(str(src), str(dst))
                    else:
                        shutil.copy2(str(src), str(dst))
                except Exception as e:
                    errors.append({"path": str(src), "error": str(e)})

    return {
        "dry_run": req.dry_run,
        "operations": len(operations),
        "errors": errors,
        "preview": operations if req.dry_run else [],
    }


# In-process thumbnail cache: {(path, size, mtime) -> bytes}
_thumb_cache: dict = {}


def _apply_exif_rotation(img):
    """
    Explicitly rotate/flip an image according to its EXIF Orientation tag.
    Handles all 8 orientation values. Returns a new image with correct orientation
    and no orientation tag (pixel data is baked in).
    """
    try:
        exif = img.getexif()
        orientation = exif.get(274)  # 274 = Orientation tag id
    except Exception:
        return img

    # Map orientation value to the required transform
    # https://exiftool.org/TagNames/EXIF.html#Orientation
    _TRANSFORMS = {
        1: None,                                          # Normal
        2: (None, True),                                  # Flip horizontal
        3: (180, False),                                  # Rotate 180
        4: (None, False, True),                           # Flip vertical
        5: (90, True),                                    # Transpose
        6: (270, False),                                  # Rotate 270 CW (= 90 CCW)
        7: (270, True),                                   # Transverse
        8: (90, False),                                   # Rotate 90 CW
    }

    transform = _TRANSFORMS.get(orientation)
    if not transform:
        return img

    from PIL import Image as PilImage
    angle, flip_h, *rest = (*transform, False)
    flip_v = rest[0] if rest else False

    if flip_h:
        img = img.transpose(PilImage.FLIP_LEFT_RIGHT)
    if flip_v:
        img = img.transpose(PilImage.FLIP_TOP_BOTTOM)
    if angle:
        img = img.rotate(angle, expand=True)

    return img


@app.get("/api/clear-thumb-cache")
async def clear_thumb_cache():
    _thumb_cache.clear()
    return {"cleared": True}


@app.get("/api/thumbnail")
async def serve_thumbnail(
    path: str = Query(..., description="Absolute path to the image file"),
    size: int = Query(200, description="Max dimension in pixels (square fit)"),
):
    """
    Return a fast, resized JPEG thumbnail for a given image path.
    Results are cached in-process so repeated requests are instant.
    """
    file_path = Path(path)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    if not is_image(str(file_path)):
        raise HTTPException(status_code=400, detail="Not a supported image file")

    cache_key = (str(file_path), size, int(file_path.stat().st_mtime))
    cached = _thumb_cache.get(cache_key)
    if cached is None:
        try:
            from PIL import Image as PilImage, ImageOps
            with PilImage.open(str(file_path)) as img:
                img = _apply_exif_rotation(img)
                img = img.convert("RGB")
                img.thumbnail((size, size), PilImage.LANCZOS)
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=75, optimize=True)
                cached = buf.getvalue()
            # Keep cache bounded — evict oldest if over 500 entries
            if len(_thumb_cache) >= 500:
                _thumb_cache.pop(next(iter(_thumb_cache)))
            _thumb_cache[cache_key] = cached
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Thumbnail generation failed: {exc}")

    return Response(
        content=cached,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "public, max-age=86400",
            "X-Thumb-Size": str(size),
        },
    )


@app.get("/api/file")
async def serve_file(path: str = Query(..., description="Absolute path to the image file")):
    """Securely stream an EXIF-corrected image file to the frontend for preview."""
    file_path = Path(path)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    if not is_image(str(file_path)):
        raise HTTPException(status_code=400, detail="Not a supported image file")

    try:
        from PIL import Image as PilImage, ImageOps
        with PilImage.open(str(file_path)) as img:
            img = _apply_exif_rotation(img)
            img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=92)
            return Response(
                content=buf.getvalue(),
                media_type="image/jpeg",
                headers={"Cache-Control": "public, max-age=3600"},
            )
    except Exception:
        # Fallback: stream raw file if PIL fails
        import mimetypes
        media_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"

        async def file_streamer():
            async with aiofiles.open(file_path, "rb") as f:
                while True:
                    chunk = await f.read(65536)
                    if not chunk:
                        break
                    yield chunk

        return StreamingResponse(file_streamer(), media_type=media_type)


@app.post("/api/generate-names")
async def api_generate_names(req: GenerateNamesRequest):
    if not req.api_key:
        raise HTTPException(status_code=400, detail="Gemini API key is required")
    if not req.clusters:
        return {"names": []}
    try:
        names = generate_event_names(req.clusters, req.api_key)
        # Pad or trim to match cluster count
        while len(names) < len(req.clusters):
            names.append(_fallback_names([req.clusters[len(names)]])[0])
        names = names[: len(req.clusters)]
        return {"names": names}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate-travelogue")
async def api_generate_travelogue(req: GenerateTravelogueRequest):
    if not req.api_key:
        raise HTTPException(status_code=400, detail="Gemini API key is required")
    try:
        markdown = generate_travelogue(req.clusters, req.destination_dir, req.api_key)

        # Optionally save it to the destination folder
        dest = Path(req.destination_dir)
        log_path = None
        if dest.exists():
            log_path = str(dest / "travel_log.md")
            with open(log_path, "w", encoding="utf-8") as f:
                f.write(markdown)

        return {"markdown": markdown, "saved_to": log_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/delete-files")
async def delete_files(req: DeleteFilesRequest):
    """Delete a list of files by absolute path. Returns counts of deleted and failed files."""
    deleted = []
    failed = []

    for raw_path in req.paths:
        file_path = Path(raw_path)
        if not file_path.exists():
            # Try resolving the path in case of symlinks or encoding issues
            try:
                resolved = file_path.resolve()
                if resolved.exists():
                    file_path = resolved
                else:
                    failed.append({"path": raw_path, "error": f"File not found: {raw_path}"})
                    continue
            except Exception:
                failed.append({"path": raw_path, "error": f"File not found: {raw_path}"})
                continue
        if not file_path.is_file():
            failed.append({"path": raw_path, "error": "Not a file"})
            continue
        if not is_image(str(file_path)):
            failed.append({"path": raw_path, "error": "Not a supported image file"})
            continue
        try:
            file_path.unlink()
            deleted.append(raw_path)
        except Exception as e:
            failed.append({"path": raw_path, "error": str(e)})

    return {"deleted": deleted, "failed": failed}


# ---------------------------------------------------------------------------
# Dev entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
