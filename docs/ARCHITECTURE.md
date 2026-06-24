# SmartSort — Architecture & How It Works

## The Stack

| Layer | Technology |
|---|---|
| Backend | Python + FastAPI |
| Frontend | React (Vite) + plain CSS |
| AI | Google Gemini API + custom PyTorch CNN |
| Communication | REST API over HTTP (localhost) |

---

## Data Flow

```
User picks folder
      ↓
React → POST /api/scan
      ↓
FastAPI walks the folder → analyze_image() for each file
      ↓
group_duplicates() + cluster_by_event()
      ↓
enrich_clusters_with_location() (Nominatim / OpenStreetMap)
      ↓
Response → React renders Events / Duplicates / Blurry tabs
      ↓
(Optional) Gemini → AI event names / travelogue
      ↓
User clicks Sort → POST /api/sort → files copied or moved
```

---

## Backend

### `analyzer.py` — Image Analysis Engine

The core of the project. For every photo it:

- Opens the image with **Pillow** and reads EXIF metadata (date taken, GPS coordinates)
- Computes a **blur score** using OpenCV's Laplacian variance — blurry images have low variance
- Computes a **perceptual hash** (dHash via `imagehash`) to find near-duplicates like burst shots
- Computes a **SHA-256 file hash** for exact duplicate detection
- Falls back to file modification time if no EXIF date exists

Two grouping functions:

- `group_duplicates()` — first groups by exact file hash, then by perceptual hash (hamming distance ≤ 8)
- `cluster_by_event()` — sorts photos by date and splits into clusters whenever there's a gap bigger than N hours (default 24h)

---

### `model.py` + `predict.py` — Blur Detection CNN

Instead of only relying on the Laplacian formula, a small **CNN** (convolutional neural network) was trained in PyTorch:

```
Input image (224×224)
      ↓
Conv2d (3 → 32 filters, 3×3) → ReLU → MaxPool2d
      ↓
Conv2d (32 → 64 filters, 3×3) → ReLU → MaxPool2d
      ↓
Flatten → FC(64×56×56 → 256) → ReLU → FC(256 → 2)
      ↓
Output: [Sharp, Blurry]
```

The model is saved to `blur_model.pth`. At startup `predict.py` lazy-loads it. If the `.pth` file is missing or PyTorch isn't installed, it gracefully falls back to the Laplacian variance method.

---

### `geocoder.py` — Reverse Geocoding

Takes the average GPS coordinates of a cluster and converts them to a human-readable place name like `"Vrindavan, Mathura, Uttar Pradesh"` using **OpenStreetMap's Nominatim** (free, no API key needed via `geopy`).

Results are cached in `geocache.json` to avoid redundant API calls across sessions.

---

### `genai_service.py` — Gemini AI Integration

Two features powered by Gemini:

- **Event naming** — sends cluster summaries (location, date, photo count) and asks Gemini to return a JSON array of creative folder names like *"Monsoon Drive Through Coorg"*
- **Travelogue** — sends all event names/locations and asks Gemini to write a first-person Markdown travel journal, saved as `travel_log.md` in the destination folder

Both include retry logic for `429` rate-limit errors and fallback names if Gemini is unavailable.

---

### `main.py` — FastAPI Server

Exposes everything as REST endpoints:

| Endpoint | What it does |
|---|---|
| `POST /api/scan` | Walks source folder, runs analyzer + geocoder, returns clusters |
| `POST /api/sort` | Copies or moves photos into `DestDir/EventName/Date/` folders |
| `GET /api/thumbnail` | Returns a resized JPEG with in-process LRU cache (up to 500 entries) |
| `GET /api/file` | Streams the full image with EXIF rotation correction |
| `POST /api/generate-names` | Calls Gemini for AI folder names |
| `POST /api/generate-travelogue` | Calls Gemini for travel log |
| `POST /api/delete-files` | Permanently deletes files by absolute path |

EXIF rotation is corrected manually by reading the `Orientation` tag (all 8 values) and applying the corresponding PIL transform before serving the image.

---

## Frontend

### `App.jsx` — React Single-Page App

- **Scan config panel** — source dir, destination dir, time gap between events
- **Tabbed results view** — Events, Duplicates, Blurry
- **Lazy-loaded thumbnails** — a single shared `IntersectionObserver` for the whole page; images only fetch when within 300px of the viewport
- **Inline editable cluster names** — click the pencil icon to rename before sorting
- **`useConfirm()` hook** — Promise-based confirm dialog (like `window.confirm` but rendered in-app)
- **Simple Markdown renderer** — renders the travelogue without an external library

### Key Libraries

| Library | Purpose |
|---|---|
| `react` + `react-dom` | UI rendering |
| `lucide-react` | Icons |
| `vite` | Dev server and build tool |

---

## Tricky Parts

- **EXIF rotation** — phones shoot in landscape but store a rotation tag; images must be re-oriented before display or they show up sideways
- **Perceptual hash duplicates** — exact hash catches identical files; dHash with hamming distance catches burst shots and re-saves
- **Lazy thumbnail system** — one `IntersectionObserver` instance shared across all `LazyThumb` components prevents performance degradation on large libraries
- **CNN fallback chain** — `predict.py` → `blur_model.pth` (CNN) → Laplacian variance (OpenCV) ensures the app works even without PyTorch installed
