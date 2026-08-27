// Rough heuristic, not measured -- FLAC compression costs a bit more CPU
// than a plain WAV write. Good enough for a ballpark "about this long".
export function estimateExportSeconds(totalDurationSeconds: number, format: 'wav' | 'flac'): number {
  const minutes = totalDurationSeconds / 60
  const secondsPerMinute = format === 'flac' ? 1.2 : 0.4
  const overhead = format === 'flac' ? 1 : 0.5
  return Math.max(1, Math.round(overhead + minutes * secondsPerMinute))
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}
