# SmartSort 📸

A local desktop tool that automatically organizes your photo library using computer vision, EXIF metadata, and AI — all running entirely on your machine.

![SmartSort UI](docs/screenshot.png)

---

## What it does

Point it at a messy folder of photos and SmartSort will:

- **Cluster photos into events** by time gap and GPS location
- **Detect duplicates** using perceptual hashing (dHash) and exact SHA-256 matching
- **Flag blurry photos** using a custom-trained CNN blur detection model + Laplacian variance fallback
- **Reverse geocode** GPS coordinates to human-readable location labels (via OpenStreetMap, no API key needed)
- **AI-name your event folders** using Google Gemini 2.5 Flash
- **Generate a travel journal** — Gemini writes a full narrative Markdown travel log from your events
- **Copy or move** photos into a clean dated folder structure
- Runs as a **Windows system tray app** — double-click, it's ready in your browser

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Lucide Icons |
| Backend | Python, FastAPI, Uvicorn |
| Computer Vision | OpenCV (blur), ImageHash (duplicates), PIL (EXIF/thumbnails) |
| ML Model | PyTorch CNN — custom-trained blur classifier |
| AI | Google Gemini 2.5 Flash (event naming + travel log) |
| Geocoding | geopy + OpenStreetMap Nominatim (cached locally) |
| Desktop | pystray (system tray), Windows .bat launcher |

---

## Getting started

### Prerequisites
- Python 3.10+
- Node.js 18+

### Run

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/SmartSort.git
cd SmartSort

# Windows — just double-click run.bat
# Or from terminal:
run.bat
```

`run.bat` handles everything automatically on first run:
1. Creates a Python virtual environment
2. Installs all Python dependencies
3. Installs Node dependencies
4. Starts the FastAPI backend and Vite frontend
5. Opens your browser at `http://localhost:5173`

### Blur model

The CNN blur detection model (`blur_model.pth`) is not included in the repo due to file size. If the model file is absent, SmartSort automatically falls back to Laplacian variance blur detection, which works well for most photos.

To use the CNN model, place `blur_model.pth` in the `backend/` folder before launching.

### Gemini API key (optional)

AI event naming and travel log generation require a Google Gemini API key. Get one free at [aistudio.google.com](https://aistudio.google.com). Enter it in the Settings panel — it's never stored to disk or sent anywhere except the Gemini API.

---

## Project structure

```
SmartSort/
├── backend/
│   ├── main.py          # FastAPI app — all API endpoints
│   ├── analyzer.py      # EXIF extraction, blur detection, duplicate hashing, event clustering
│   ├── model.py         # PyTorch CNN architecture (BlurCNN)
│   ├── predict.py       # CNN inference wrapper
│   ├── genai_service.py # Gemini API integration (naming + travelogue)
│   ├── geocoder.py      # Reverse geocoding with local cache
│   ├── tray.py          # Windows system tray launcher
│   ├── make_icon.py     # Icon generator
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx      # Full single-page dashboard
│   │   └── index.css    # Design system (dark mode, CSS variables)
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── run.bat              # One-click Windows launcher
```

---

## Features in detail

### Duplicate detection
Uses two passes:
1. **Exact match** — SHA-256 file hash (catches identical copies)
2. **Near match** — dHash perceptual hashing with Hamming distance ≤ 8 (catches burst shots, slight crops, re-saves)

### Blur detection
Two-mode system:
- **CNN model** (when `blur_model.pth` is present): custom PyTorch classifier trained on sharp/blurry image pairs, returns confidence score
- **Laplacian fallback**: OpenCV Laplacian variance — fast, no model needed

### Event clustering
Groups photos by time gap (configurable: 4h–72h). Each cluster gets:
- Date range from EXIF
- Average GPS → reverse geocoded to city/state/country label
- AI-generated descriptive name (or fallback: `Location – Date`)

### EXIF rotation
All thumbnails and preview images are rotation-corrected server-side. Handles all 8 EXIF orientation values by baking the transform into the pixel data before serving — consistent across all browsers.


