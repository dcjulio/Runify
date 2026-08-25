import shutil
import uuid
from pathlib import Path

import librosa
import soundfile as sf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import analysis
from .storage import get_track, track_dir, tracks

app = FastAPI(title="Runify backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/tracks")
async def upload_track(file: UploadFile = File(...)):
    track_id = uuid.uuid4().hex
    tdir = track_dir(track_id)

    ext = Path(file.filename or "").suffix or ".bin"
    original_path = tdir / f"original{ext}"
    with original_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        y, sr = librosa.load(original_path, sr=None, mono=True)
    except Exception as exc:
        shutil.rmtree(tdir, ignore_errors=True)
        raise HTTPException(400, f"Could not decode audio file: {exc}") from exc

    bpm = analysis.detect_bpm(y, sr)
    key = analysis.detect_key(y, sr)
    duration = librosa.get_duration(y=y, sr=sr)

    tracks[track_id] = {
        "original_path": original_path,
        "filename": file.filename,
        "bpm": bpm,
        "key": key,
        "duration": duration,
        "sr": sr,
    }

    return {
        "track_id": track_id,
        "filename": file.filename,
        "bpm": bpm,
        "key": key,
        "duration": duration,
    }


@app.get("/tracks/{track_id}/audio")
def get_track_audio(track_id: str):
    track = get_track(track_id)
    if not track:
        raise HTTPException(404, "Track not found")
    return FileResponse(track["original_path"])


class RetempoRequest(BaseModel):
    target_bpm: float


@app.post("/tracks/{track_id}/retempo")
def retempo_track(track_id: str, req: RetempoRequest):
    track = get_track(track_id)
    if not track:
        raise HTTPException(404, "Track not found")
    if req.target_bpm <= 0:
        raise HTTPException(400, "target_bpm must be positive")

    y, sr = librosa.load(track["original_path"], sr=None, mono=False)
    y_stretched = analysis.retempo(y, sr, track["bpm"], req.target_bpm)

    out_path = track_dir(track_id) / "retempo.wav"
    sf.write(out_path, y_stretched, sr)

    return {
        "track_id": track_id,
        "target_bpm": req.target_bpm,
        "duration": y_stretched.shape[0] / sr,
    }


@app.get("/tracks/{track_id}/retempo/audio")
def get_retempo_audio(track_id: str):
    track = get_track(track_id)
    if not track:
        raise HTTPException(404, "Track not found")
    out_path = track_dir(track_id) / "retempo.wav"
    if not out_path.exists():
        raise HTTPException(404, "No retempo render yet for this track")
    return FileResponse(out_path)
