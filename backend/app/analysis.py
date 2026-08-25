import librosa
import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

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


def _wsola(x: np.ndarray, alpha: float, sr: int) -> np.ndarray:
    """Waveform-similarity overlap-add time-scale modification.

    alpha = output length / input length (alpha < 1 speeds up, alpha > 1 slows
    down). Splices real waveform segments chosen by cross-correlation instead
    of interpolating phase in the frequency domain, so percussive transients
    (drum hits) keep their sharp shape instead of smearing -- the failure mode
    of a plain phase vocoder like librosa.effects.time_stretch.
    """
    frame_len = max(256, int(round(0.04 * sr)))
    frame_len -= frame_len % 2
    hop_out = frame_len // 2
    hop_in = max(1, int(round(hop_out / alpha)))
    tol = hop_out
    overlap = frame_len - hop_out

    window = np.hanning(frame_len)
    xp = np.pad(x, (0, frame_len + tol))

    out_len = int(np.ceil(len(x) * alpha)) + frame_len
    y = np.zeros(out_len)
    norm = np.zeros(out_len)

    prev_offset = 0
    y[0:frame_len] += xp[0:frame_len] * window
    norm[0:frame_len] += window
    syn_pos = hop_out
    max_offset = max(0, len(x) - 1)

    while syn_pos + frame_len < out_len and prev_offset < max_offset:
        reference = xp[prev_offset + hop_out : prev_offset + hop_out + overlap]
        ideal = prev_offset + hop_in
        lo = max(0, ideal - tol)
        hi = min(max_offset, ideal + tol)

        if hi <= lo:
            offset = min(max(ideal, 0), max_offset)
        else:
            candidates = sliding_window_view(xp[lo : hi + overlap], overlap)
            ref_norm = np.linalg.norm(reference) + 1e-8
            cand_norms = np.linalg.norm(candidates, axis=1) + 1e-8
            scores = (candidates @ reference) / (cand_norms * ref_norm)
            offset = lo + int(np.argmax(scores))

        y[syn_pos : syn_pos + frame_len] += xp[offset : offset + frame_len] * window
        norm[syn_pos : syn_pos + frame_len] += window

        prev_offset = offset
        syn_pos += hop_out

    norm[norm < 1e-6] = 1.0
    y = y / norm
    target_len = int(round(len(x) * alpha))
    return y[:target_len]


def retempo(y: np.ndarray, sr: int, current_bpm: float, target_bpm: float) -> np.ndarray:
    rate = target_bpm / current_bpm
    alpha = 1.0 / rate
    return _wsola(y, alpha, sr)
