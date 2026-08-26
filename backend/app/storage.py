import hashlib
import json
from pathlib import Path

import librosa
import soundfile as sf

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

MIXES_DIR = Path(__file__).resolve().parent.parent / "mixes"
MIXES_DIR.mkdir(exist_ok=True)

# Where the user drops their own downloaded music (via Explorer, outside the
# app), sitting right next to the project itself. Tracks are picked from
# here rather than uploaded through a browser file dialog -- picking the
# same file twice reuses the same track_id (derived from its path below)
# instead of creating a duplicate.
LIBRARY_DIR = Path(__file__).resolve().parent.parent.parent / "My Songs"
LIBRARY_DIR.mkdir(parents=True, exist_ok=True)

tracks: dict[str, dict] = {}


def track_dir(track_id: str) -> Path:
    d = DATA_DIR / track_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def track_id_for_path(path: Path) -> str:
    """Deterministic id from a library file's absolute path -- so picking
    the same file again (e.g. after a restart, or clicking Add twice)
    always resolves to the same track_id instead of re-analyzing or
    duplicating it. Renaming or moving the file is treated as a different
    track, same as the user already understood when asking about this."""
    return hashlib.sha1(str(path.resolve()).encode("utf-8")).hexdigest()


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
        "detected_bpm": track["detected_bpm"],
        "key": track["key"],
        "duration": track["duration"],
        "sr": track["sr"],
        # the audio itself lives wherever the user put it in the library
        # folder -- it's never copied, so this is a reference, not a name
        "source_path": str(track["original_path"]),
    }
    (track_dir(track_id) / "meta.json").write_text(json.dumps(meta))


def rebuild_tracks_from_disk() -> None:
    """Repopulate the in-memory track index from meta.json sidecars on
    disk. Runs at server startup so tracks analyzed in a previous run (and
    any saved mixes referencing them) are still there without
    re-analyzing -- the in-memory dict is otherwise wiped by every
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
        source_path = meta.get("source_path")
        if not source_path:
            continue  # from before the library folder existed -- orphaned
        original_path = Path(source_path)
        if not original_path.exists():
            continue  # moved or deleted out of the library folder
        tracks[d.name] = {
            "original_path": original_path,
            "filename": meta["filename"],
            "bpm": meta["bpm"],
            # older meta.json files (written before BPM correction/reset
            # existed) won't have this key -- fall back to bpm, the best
            # available guess for what was originally detected
            "detected_bpm": meta.get("detected_bpm", meta["bpm"]),
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


def get_track_retempo_bpm(track_id: str) -> float | None:
    """What target BPM the current retempo.wav (if any) was rendered at --
    lets callers skip recomputing a retempo that's already sitting there at
    the requested tempo (e.g. loading a saved mix re-requests the same BPM
    every time). Checks memory first, falls back to a small sidecar on disk
    written by save_track_retempo_bpm so this survives a restart too."""
    track = tracks[track_id]
    if "retempo_bpm" in track:
        return track["retempo_bpm"]
    meta_path = track_dir(track_id) / "retempo_meta.json"
    if not meta_path.exists():
        return None
    try:
        return json.loads(meta_path.read_text())["target_bpm"]
    except (json.JSONDecodeError, OSError, KeyError):
        return None


def save_track_retempo_bpm(track_id: str, target_bpm: float) -> None:
    (track_dir(track_id) / "retempo_meta.json").write_text(json.dumps({"target_bpm": target_bpm}))


def clear_track_retempo(track_id: str) -> None:
    """Discards any existing retempo render for a track, in memory and on
    disk. Used when the reference BPM changes (a manual correction) --
    any prior render was computed against the old reference, so its
    stretch ratio is now wrong, not just its label."""
    track = tracks[track_id]
    track.pop("retempo_audio", None)
    track.pop("retempo_sr", None)
    track.pop("retempo_bpm", None)
    (track_dir(track_id) / "retempo.wav").unlink(missing_ok=True)
    (track_dir(track_id) / "retempo_meta.json").unlink(missing_ok=True)
