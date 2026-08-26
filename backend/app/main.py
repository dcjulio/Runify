import asyncio
import io
import os
import re
import shutil
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import librosa
import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from . import analysis, storage
from .storage import get_track, track_dir, tracks


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Repopulate tracks from previously uploaded files on disk -- otherwise
    # every restart (which --reload triggers on every backend edit) wipes
    # the in-memory index and breaks any saved playlist referencing them.
    storage.rebuild_tracks_from_disk()

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
    storage.save_track_meta(track_id)

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

    # Skip recomputing if a render already sits there at this exact target
    # -- e.g. loading a saved mix re-requests the same BPM every time, which
    # was previously re-running the full WSOLA stretch for no reason.
    if storage.get_track_retempo_bpm(track_id) == req.target_bpm:
        cached = storage.get_track_retempo_audio(track_id)
        if cached is not None:
            cached_audio, cached_sr = cached
            return {
                "track_id": track_id,
                "target_bpm": req.target_bpm,
                "duration": cached_audio.shape[0] / cached_sr,
            }

    audio = storage.get_track_audio(track_id)
    y_stretched = analysis.retempo(audio, track["sr"], track["bpm"], req.target_bpm)
    sr = track["sr"]

    # cached (soundfile convention) so /mix/export can reuse it without
    # re-reading the rendered file from disk
    track["retempo_audio"] = y_stretched
    track["retempo_sr"] = sr
    track["retempo_bpm"] = req.target_bpm

    out_path = track_dir(track_id) / "retempo.wav"
    sf.write(out_path, y_stretched, sr)
    storage.save_track_retempo_bpm(track_id, req.target_bpm)

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


class ExportTrackSpec(BaseModel):
    track_id: str
    version: Literal["original", "retempo"]


class ExportRequest(BaseModel):
    tracks: list[ExportTrackSpec]


@app.post("/mix/export")
def export_mix(req: ExportRequest):
    """Concatenates tracks in queue order, no crossfade/transition -- each
    track contributes whichever version (original/retempo) was selected in
    the UI. A simpler milestone before beatmatched crossfade mixing."""
    if not req.tracks:
        raise HTTPException(400, "No tracks provided")

    segments = []
    target_sr: int | None = None

    for spec in req.tracks:
        track = get_track(spec.track_id)
        if not track:
            raise HTTPException(404, f"Track not found: {spec.track_id}")

        if spec.version == "retempo":
            result = storage.get_track_retempo_audio(spec.track_id)
            if result is None:
                raise HTTPException(400, f"Track {spec.track_id} has no retempo render yet")
            y, sr = result
        else:
            y_multi = storage.get_track_audio(spec.track_id)
            sr = track["sr"]
            y = y_multi.T if y_multi.ndim == 2 else y_multi

        if target_sr is None:
            target_sr = sr
        elif sr != target_sr:
            y = analysis.resample_soundfile(y, sr, target_sr)

        segments.append(analysis.to_stereo(y))

    mixed = np.concatenate(segments, axis=0)

    buffer = io.BytesIO()
    sf.write(buffer, mixed, target_sr, format="WAV")

    return Response(
        content=buffer.getvalue(),
        media_type="audio/wav",
        headers={"Content-Disposition": 'attachment; filename="runify-mix.wav"'},
    )


_PLAYLIST_NAME_RE = re.compile(r"^[\w\- ]{1,100}$")


def _safe_playlist_name(name: str) -> str:
    name = name.strip()
    if not name or not _PLAYLIST_NAME_RE.match(name):
        raise HTTPException(400, "Playlist name must be 1-100 characters: letters, numbers, spaces, - or _")
    return name


class PlaylistTrackSpec(BaseModel):
    track_id: str
    target_bpm: float | None = None
    version: Literal["original", "retempo"] = "original"


class SavePlaylistRequest(BaseModel):
    name: str
    tracks: list[PlaylistTrackSpec]


@app.post("/playlists")
def save_playlist(req: SavePlaylistRequest):
    name = _safe_playlist_name(req.name)
    path = storage.PLAYLISTS_DIR / f"{name}.json"
    path.write_text(
        SavePlaylistRequest(name=name, tracks=req.tracks).model_dump_json(),
    )
    return {"name": name}


@app.get("/playlists")
def list_playlists():
    names = sorted((p.stem for p in storage.PLAYLISTS_DIR.glob("*.json")), key=str.lower)
    return {"playlists": names}


@app.get("/playlists/{name}")
def load_playlist(name: str):
    name = _safe_playlist_name(name)
    path = storage.PLAYLISTS_DIR / f"{name}.json"
    if not path.exists():
        raise HTTPException(404, "Playlist not found")

    saved = SavePlaylistRequest.model_validate_json(path.read_text())

    enriched = []
    for t in saved.tracks:
        track = get_track(t.track_id)
        if not track:
            continue  # referenced track's files no longer exist on disk
        enriched.append(
            {
                "track_id": t.track_id,
                "target_bpm": t.target_bpm,
                "version": t.version,
                "filename": track["filename"],
                "bpm": track["bpm"],
                "key": track["key"],
                "duration": track["duration"],
            }
        )
    return {"name": name, "tracks": enriched}


@app.post("/playlists/open-folder")
def open_playlists_folder():
    """Opens backend/playlists/ in the OS file explorer, and brings it to
    the front. Only meaningful because this backend always runs locally on
    the same machine as the person using it -- never do this in a real
    multi-user web app."""
    os.startfile(storage.PLAYLISTS_DIR)  # noqa: S606 -- local-only tool, see above
    _bring_explorer_to_front()
    return {"status": "ok"}


def _bring_explorer_to_front() -> None:
    """Windows blocks a background process (like this server) from
    stealing focus for a window it opens -- by design, so background apps
    can't yank focus away from whatever you're doing. Simulating a keypress
    resets the OS's foreground-lock timeout, which is the standard
    workaround. Best-effort: grabs whichever Explorer window is topmost, so
    it can occasionally grab the wrong one if several are already open."""
    try:
        import ctypes
        import time

        user32 = ctypes.windll.user32
        user32.keybd_event(0x12, 0, 0, 0)  # VK_MENU (Alt) down
        user32.keybd_event(0x12, 0, 0x0002, 0)  # Alt up
        for _ in range(10):
            hwnd = user32.FindWindowW("CabinetWClass", None)
            if hwnd:
                user32.ShowWindow(hwnd, 9)  # SW_RESTORE
                user32.SetForegroundWindow(hwnd)
                return
            time.sleep(0.1)
    except Exception:
        pass  # best-effort only -- the folder still opened either way
