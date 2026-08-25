import asyncio
import shutil
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import analysis
from .storage import get_track, track_dir, tracks


@asynccontextmanager
async def lifespan(app: FastAPI):
    # detect_bpm and detect_key run concurrently in worker threads per
    # upload. Both lazily import scipy.signal/scipy.linalg submodules on
    # first use -- if two threads hit that first import at the same instant,
    # Python's import lock can deadlock. Warming both up here, single
    # threaded, before any request arrives, means those imports are already
    # cached by the time real concurrent calls happen.
    dummy = np.sin(np.linspace(0, 200, 44100)).astype(np.float32)
    analysis.detect_bpm(dummy, 22050)
    analysis.detect_key(dummy, 22050)
    yield


app = FastAPI(title="Runify backend", lifespan=lifespan)

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
        y_multi, sr = librosa.load(original_path, sr=None, mono=False)
    except Exception as exc:
        shutil.rmtree(tdir, ignore_errors=True)
        raise HTTPException(400, f"Could not decode audio file: {exc}") from exc

    y_mono = librosa.to_mono(y_multi) if y_multi.ndim == 2 else y_multi

    # BPM stays at full sample rate (downsampling measurably shifted the
    # detected tempo in testing); key detection is robust to downsampling
    # (verified unchanged) and is done inside detect_key. Running both
    # concurrently in worker threads overlaps their compute instead of
    # paying for each in sequence -- the underlying numpy/scipy calls
    # release the GIL, so this is a real wall-clock win.
    loop = asyncio.get_event_loop()
    bpm_task = loop.run_in_executor(None, analysis.detect_bpm, y_mono, sr)
    key_task = loop.run_in_executor(None, analysis.detect_key, y_mono, sr)
    bpm, key = await asyncio.gather(bpm_task, key_task)
    duration = librosa.get_duration(y=y_mono, sr=sr)

    tracks[track_id] = {
        "original_path": original_path,
        "filename": file.filename,
        "bpm": bpm,
        "key": key,
        "duration": duration,
        "sr": sr,
        # cached decoded audio (librosa convention: (samples,) mono or
        # (channels, samples) stereo) so retempo never re-decodes the
        # original file from disk
        "audio": y_multi,
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

    y_stretched = analysis.retempo(track["audio"], track["sr"], track["bpm"], req.target_bpm)
    sr = track["sr"]

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
