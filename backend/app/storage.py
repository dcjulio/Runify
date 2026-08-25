from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

tracks: dict[str, dict] = {}


def track_dir(track_id: str) -> Path:
    d = DATA_DIR / track_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_track(track_id: str) -> dict | None:
    return tracks.get(track_id)
