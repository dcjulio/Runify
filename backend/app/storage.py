import json
from pathlib import Path

import librosa
import soundfile as sf

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

PLAYLISTS_DIR = Path(__file__).resolve().parent.parent / "playlists"
PLAYLISTS_DIR.mkdir(exist_ok=True)

tracks: dict[str, dict] = {}


def track_dir(track_id: str) -> Path:
    d = DATA_DIR / track_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_track(track_id: str) -> dict | None:
    return tracks.get(track_id)


def save_track_meta(track_id: str) -> None:
    """Persist a track's analysis metadata (not the decoded audio -- that
    stays in memory only, see get_track_audio) so it survives a backend
    restart and can be found again by rebuild_tracks_from_disk."""
    track = tracks[track_id]
    meta = {
        "filename": track["filename"],
        "bpm": track["bpm"],
        "key": track["key"],
        "duration": track["duration"],
        "sr": track["sr"],
        "original_filename": track["original_path"].name,
    }
    (track_dir(track_id) / "meta.json").write_text(json.dumps(meta))


def rebuild_tracks_from_disk() -> None:
    """Repopulate the in-memory track index from meta.json sidecars on
    disk. Runs at server startup so tracks uploaded in a previous run (and
    any saved playlists referencing them) are still there without
    re-uploading -- the in-memory dict is otherwise wiped by every
    restart. Decoded audio is deliberately NOT reloaded here (expensive
    for a whole library); it's lazily decoded on first actual use by
    get_track_audio.
    """
    for d in DATA_DIR.iterdir():
        if not d.is_dir():
            continue
        meta_path = d / "meta.json"
        if not meta_path.exists():
            continue
        try:
            meta = json.loads(meta_path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        original_path = d / meta["original_filename"]
        if not original_path.exists():
            continue
        tracks[d.name] = {
            "original_path": original_path,
            "filename": meta["filename"],
            "bpm": meta["bpm"],
            "key": meta["key"],
            "duration": meta["duration"],
            "sr": meta["sr"],
        }


def get_track_audio(track_id: str):
    """Cached decoded audio (librosa convention). Decodes from disk and
    caches on first use if not already in memory -- covers both a fresh
    upload (already cached at upload time) and a track rebuilt from disk
    metadata after a restart (not yet decoded)."""
    track = tracks[track_id]
    if "audio" not in track:
        y_multi, sr = librosa.load(track["original_path"], sr=None, mono=False)
        track["audio"] = y_multi
        track["sr"] = sr
    return track["audio"]


def get_track_retempo_audio(track_id: str):
    """Cached retempoed audio (soundfile convention) + its sample rate, or
    None if this track has never been retempoed. Falls back to reading the
    rendered retempo.wav from disk if it exists but isn't cached in memory
    (e.g. after a restart)."""
    track = tracks[track_id]
    if "retempo_audio" not in track:
        retempo_path = track_dir(track_id) / "retempo.wav"
        if not retempo_path.exists():
            return None
        y, sr = sf.read(retempo_path)
        track["retempo_audio"] = y
        track["retempo_sr"] = sr
    return track["retempo_audio"], track["retempo_sr"]
