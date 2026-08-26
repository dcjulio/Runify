# Runify

A local tool for building a running mix from your own downloaded music: upload songs, see their BPM/key, retempo them to match, drag transition points on the waveform, and export the whole queue as one continuous audio file.

Everything runs locally. Nothing is uploaded anywhere.

## Architecture

- **`backend/`** — Python (FastAPI). Does all the audio work: decoding, BPM/key detection (librosa), time-stretching, crossfade mixing, final render. Runs on `http://localhost:8001`.
- **root** — React + TypeScript (Vite). The interactive UI: upload, waveform display, draggable transition markers. Runs on `http://localhost:5173`.

## Running it

**Quick start:** double-click `start-runify.bat`. It opens the backend and frontend each in their own terminal window and opens the app in your browser once both are up. Close either window (or Ctrl+C inside it) to stop that server.

**Manual start** (same thing, by hand): two servers, two terminals.

**Backend:**

```
cd backend
.venv\Scripts\activate
uvicorn app.main:app --reload --port 8001
```

(Port 8001, not the default 8000 — on this machine 8000 has a stuck orphaned socket that Windows won't release.)

**Frontend:**

```
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

## First-time setup

```
# frontend deps
npm install

# backend venv + deps
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Requires [ffmpeg](https://ffmpeg.org/) on your `PATH` for broad audio format support (MP3, etc).

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free to use, study, and modify for any noncommercial purpose. Commercial use is not permitted.
