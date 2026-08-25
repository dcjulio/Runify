import librosa
import numpy as np

MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def detect_bpm(y: np.ndarray, sr: int) -> float:
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    tempo = tempo.item() if hasattr(tempo, "item") else tempo
    return round(float(tempo), 2)


def detect_key(y: np.ndarray, sr: int) -> str:
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    profile = chroma.mean(axis=1)

    best_score = -np.inf
    best_key = None
    for i in range(12):
        major_score = np.corrcoef(profile, np.roll(MAJOR_PROFILE, i))[0, 1]
        if major_score > best_score:
            best_score = major_score
            best_key = f"{PITCH_CLASSES[i]} major"

        minor_score = np.corrcoef(profile, np.roll(MINOR_PROFILE, i))[0, 1]
        if minor_score > best_score:
            best_score = minor_score
            best_key = f"{PITCH_CLASSES[i]} minor"

    return best_key


def retempo(y: np.ndarray, current_bpm: float, target_bpm: float) -> np.ndarray:
    rate = target_bpm / current_bpm
    return librosa.effects.time_stretch(y, rate=rate)
