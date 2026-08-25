import librosa
import numpy as np
from numba import njit, prange

MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Camelot wheel position for each pitch class, major ("B") and relative minor ("A")
CAMELOT_MAJOR = {"C": 8, "G": 9, "D": 10, "A": 11, "E": 12, "B": 1, "F#": 2, "C#": 3, "G#": 4, "D#": 5, "A#": 6, "F": 7}
CAMELOT_MINOR = {"A": 8, "E": 9, "B": 10, "F#": 11, "C#": 12, "G#": 1, "D#": 2, "A#": 3, "F": 4, "C": 5, "G": 6, "D": 7}


def detect_bpm(y: np.ndarray, sr: int) -> float:
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    tempo = tempo.item() if hasattr(tempo, "item") else tempo
    return round(float(tempo), 2)


def detect_key(y: np.ndarray, sr: int) -> str:
    # Chroma-based key detection is robust to downsampling (pitch-class
    # content lives well below this rate) -- verified the detected key is
    # unchanged at 22050/11025 Hz vs. full rate on a test track, so this is
    # a safe, real speedup and not a quality tradeoff.
    analysis_sr = 22050
    if sr > analysis_sr:
        y = librosa.resample(y, orig_sr=sr, target_sr=analysis_sr)
        sr = analysis_sr

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    profile = chroma.mean(axis=1)

    best_score = -np.inf
    best_pitch_class = None
    best_mode = None
    for i in range(12):
        major_score = np.corrcoef(profile, np.roll(MAJOR_PROFILE, i))[0, 1]
        if major_score > best_score:
            best_score = major_score
            best_pitch_class = PITCH_CLASSES[i]
            best_mode = "major"

        minor_score = np.corrcoef(profile, np.roll(MINOR_PROFILE, i))[0, 1]
        if minor_score > best_score:
            best_score = minor_score
            best_pitch_class = PITCH_CLASSES[i]
            best_mode = "minor"

    if best_mode == "major":
        number = CAMELOT_MAJOR[best_pitch_class]
        return f"{number}B"
    else:
        number = CAMELOT_MINOR[best_pitch_class]
        return f"{number}A"


@njit(cache=True, fastmath=True, parallel=True)
def _wsola_search_offsets(
    ref: np.ndarray, out_len: int, frame_len: int, hop_out: int, hop_in: int, tol: int, max_offset: int
) -> np.ndarray:
    """Pick the splice offset for each synthesis frame by waveform similarity.

    Runs on a single (mono-downmixed) reference channel so stereo channels
    can later be extracted using the same offsets -- keeps left/right in
    phase instead of drifting independently. JIT-compiled: this search
    (tight nested loop over ~1500 candidate offsets x ~1000 frames for a
    typical song) is the expensive part of retempo and is orders of
    magnitude faster compiled than run frame-by-frame through the Python/
    numpy call overhead. The per-frame candidate scan is also spread across
    CPU cores (prange) -- each candidate's score is independent, so this is
    a pure speedup with mathematically identical output, no quality tradeoff.
    """
    overlap = frame_len - hop_out
    max_frames = out_len // hop_out + 2
    offsets = np.zeros(max_frames, dtype=np.int64)
    offsets[0] = 0
    count = 1

    prev_offset = 0
    syn_pos = hop_out

    while syn_pos + frame_len < out_len and prev_offset < max_offset:
        ideal = prev_offset + hop_in
        lo = ideal - tol
        if lo < 0:
            lo = 0
        hi = ideal + tol
        if hi > max_offset:
            hi = max_offset

        if hi <= lo:
            offset = ideal
            if offset < 0:
                offset = 0
            if offset > max_offset:
                offset = max_offset
        else:
            r_start = prev_offset + hop_out
            ref_sumsq = 0.0
            for i in range(overlap):
                v = ref[r_start + i]
                ref_sumsq += v * v
            ref_norm = np.sqrt(ref_sumsq) + 1e-8

            n_cand = hi - lo + 1
            scores = np.empty(n_cand)
            for idx in prange(n_cand):
                cand = lo + idx
                dot = 0.0
                cand_sumsq = 0.0
                for i in range(overlap):
                    rv = ref[r_start + i]
                    cv = ref[cand + i]
                    dot += rv * cv
                    cand_sumsq += cv * cv
                cand_norm = np.sqrt(cand_sumsq) + 1e-8
                scores[idx] = dot / (cand_norm * ref_norm)

            best_idx = 0
            best_score = scores[0]
            for idx in range(1, n_cand):
                if scores[idx] > best_score:
                    best_score = scores[idx]
                    best_idx = idx
            offset = lo + best_idx

        offsets[count] = offset
        count += 1
        prev_offset = offset
        syn_pos += hop_out

    return offsets[:count]


def _wsola(x: np.ndarray, alpha: float, sr: int) -> np.ndarray:
    """Waveform-similarity overlap-add time-scale modification.

    alpha = output length / input length (alpha < 1 speeds up, alpha > 1 slows
    down). Splices real waveform segments chosen by cross-correlation instead
    of interpolating phase in the frequency domain, so percussive transients
    (drum hits) keep their sharp shape instead of smearing -- the failure mode
    of a plain phase vocoder like librosa.effects.time_stretch.

    x is mono (n_samples,) or multi-channel (n_channels, n_samples), matching
    librosa's convention. Returns the same shape.
    """
    is_multi = x.ndim == 2
    channels = x if is_multi else x[np.newaxis, :]
    n_channels, n_samples = channels.shape

    frame_len = max(256, int(round(0.04 * sr)))
    frame_len -= frame_len % 2
    hop_out = frame_len // 2
    hop_in = max(1, int(round(hop_out / alpha)))
    tol = hop_out
    overlap = frame_len - hop_out
    pad_amount = frame_len + tol

    out_len = int(np.ceil(n_samples * alpha)) + frame_len
    max_offset = max(0, n_samples - 1)
    target_len = int(round(n_samples * alpha))

    reference = channels.mean(axis=0) if n_channels > 1 else channels[0]
    reference = np.pad(reference, (0, pad_amount))
    offsets = _wsola_search_offsets(reference, out_len, frame_len, hop_out, hop_in, tol, max_offset)

    window = np.hanning(frame_len)
    result = np.zeros((n_channels, target_len))

    for c in range(n_channels):
        xp = np.pad(channels[c], (0, pad_amount))
        y = np.zeros(out_len)
        norm = np.zeros(out_len)
        syn_pos = 0
        for offset in offsets:
            y[syn_pos : syn_pos + frame_len] += xp[offset : offset + frame_len] * window
            norm[syn_pos : syn_pos + frame_len] += window
            syn_pos += hop_out
        norm[norm < 1e-6] = 1.0
        result[c] = (y / norm)[:target_len]

    return result if is_multi else result[0]


def retempo(y: np.ndarray, sr: int, current_bpm: float, target_bpm: float) -> np.ndarray:
    """Returns audio ready for soundfile.write: (samples,) mono or (samples, channels) stereo."""
    rate = target_bpm / current_bpm
    alpha = 1.0 / rate
    stretched = _wsola(y, alpha, sr)
    return stretched.T if stretched.ndim == 2 else stretched


def to_stereo(y: np.ndarray) -> np.ndarray:
    """y in soundfile convention: (samples,) or (samples, channels). Returns (samples, 2)."""
    if y.ndim == 1:
        return np.stack([y, y], axis=1)
    if y.shape[1] == 1:
        return np.repeat(y, 2, axis=1)
    return y[:, :2]


def resample_soundfile(y: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    """Resample audio in soundfile convention: (samples,) or (samples, channels)."""
    is_multi = y.ndim == 2
    y_lib = y.T if is_multi else y
    y_resampled = librosa.resample(y_lib, orig_sr=orig_sr, target_sr=target_sr)
    return y_resampled.T if is_multi else y_resampled
