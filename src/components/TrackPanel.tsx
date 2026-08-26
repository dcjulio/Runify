import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import {
  type LoadedPlaylistTrack,
  type TrackInfo,
  type TrackVersion,
  retempoAudioUrl,
  retempoTrack,
  trackAudioUrl,
  uploadTrack,
} from '../api'

export interface TrackStatus {
  trackId: string | null
  version: TrackVersion
}

export interface TrackPanelHandle {
  applyTempo: (bpm: number) => void
}

// BPM detection (and DJ tempo-matching in general) is ambiguous at
// half/double time -- a track flagged at 83 could just as validly be felt
// as 166. When applying one target to a whole queue, snap to whichever
// octave of the target (target, target/2, target*2, target/4, target*4)
// is proportionally closest to this track's own detected BPM, rather than
// always stretching to the literal target -- e.g. an 83 BPM track with a
// 160 BPM target retempos to 80 (a ~4% adjustment) instead of 160 (a ~93%
// stretch that would sound wrecked and defeats the point).
function nearestOctaveTarget(trackBpm: number, targetBpm: number): number {
  if (!trackBpm || trackBpm <= 0) return targetBpm
  // Literal target checked first so an exact tie (e.g. 120 vs. a 160
  // target, equidistant from both 80 and 160) keeps the literal target
  // instead of arbitrarily picking a shifted one.
  const candidates = [targetBpm, targetBpm / 2, targetBpm * 2, targetBpm / 4, targetBpm * 4]
  let best = targetBpm
  let bestDiff = Infinity
  for (const c of candidates) {
    const diff = Math.abs(c - trackBpm) / trackBpm
    if (diff < bestDiff) {
      bestDiff = diff
      best = c
    }
  }
  return best
}

interface TrackPanelProps {
  index: number
  totalTracks: number
  initialFile?: File
  existingTrack?: LoadedPlaylistTrack
  onRemove: () => void
  onMove: (newPosition: number) => void
  onStatusChange: (status: TrackStatus) => void
}

export const TrackPanel = forwardRef<TrackPanelHandle, TrackPanelProps>(function TrackPanel(
  { index, totalTracks, initialFile, existingTrack, onRemove, onMove, onStatusChange },
  ref,
) {
  const [track, setTrack] = useState<TrackInfo | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [targetBpm, setTargetBpm] = useState<number>(0)
  const [retempoing, setRetempoing] = useState(false)
  const [retempoUrl, setRetempoUrl] = useState<string | null>(null)
  const [retempoBpm, setRetempoBpm] = useState<number | null>(null)
  const [retempoDuration, setRetempoDuration] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<TrackVersion>('original')
  const [isPlaying, setIsPlaying] = useState(false)
  const [positionInput, setPositionInput] = useState(String(index + 1))
  const [lastFile, setLastFile] = useState<File | null>(null)

  useEffect(() => {
    onStatusChange({ trackId: track?.track_id ?? null, version: viewMode })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, viewMode])

  useEffect(() => {
    setPositionInput(String(index + 1))
  }, [index])

  function commitPosition() {
    const n = Number.parseInt(positionInput, 10)
    if (Number.isFinite(n)) {
      onMove(n)
    } else {
      setPositionInput(String(index + 1))
    }
  }

  const containerRef = useRef<HTMLDivElement | null>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#8b8b9e',
      progressColor: '#6c5ce7',
      height: 96,
      cursorColor: '#fff',
    })
    ws.on('play', () => setIsPlaying(true))
    ws.on('pause', () => setIsPlaying(false))
    ws.on('finish', () => setIsPlaying(false))
    wavesurferRef.current = ws
    return () => {
      ws.destroy()
      wavesurferRef.current = null
    }
  }, [])

  async function uploadFile(file: File) {
    setLastFile(file)
    setUploading(true)
    setError(null)
    setRetempoUrl(null)
    setRetempoBpm(null)
    setRetempoDuration(null)
    setViewMode('original')
    try {
      const info = await uploadTrack(file)
      setTrack(info)
      setTargetBpm(info.bpm)
      await wavesurferRef.current?.load(trackAudioUrl(info.track_id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  async function hydrateExisting(t: LoadedPlaylistTrack) {
    // Saved mixes only remember track identity and order, not any retempo
    // -- re-apply BPM changes yourself after loading (Apply to all makes
    // that quick). Keeps this to one simple, reliable thing: same songs,
    // same order, every time.
    const info: TrackInfo = {
      track_id: t.track_id,
      filename: t.filename,
      bpm: t.bpm,
      key: t.key,
      duration: t.duration,
    }
    setTrack(info)
    setTargetBpm(t.bpm)
    await wavesurferRef.current?.load(trackAudioUrl(t.track_id))
  }

  const seededRef = useRef(false)

  useEffect(() => {
    // StrictMode (see main.tsx) deliberately mounts, unmounts, and
    // remounts every component once in dev, re-running "on mount" effects
    // twice. Without this guard, hydrateExisting/uploadFile would fire
    // twice concurrently for the same track -- refs survive that simulated
    // cycle (state does too), so checking one here reliably makes only the
    // first invocation actually do anything.
    if (seededRef.current) return
    seededRef.current = true

    if (initialFile) {
      void uploadFile(initialFile)
    } else if (existingTrack) {
      void hydrateExisting(existingTrack)
    }
    // initialFile/existingTrack are only meant to seed this instance once,
    // on creation -- a given slot is always exactly one of "new upload" or
    // "loaded from a saved mix", never both, never changing after mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function applyRetempo(trackId: string, bpm: number) {
    setTargetBpm(bpm)
    setRetempoing(true)
    setError(null)
    try {
      const result = await retempoTrack(trackId, bpm)
      const url = `${retempoAudioUrl(trackId)}?t=${Date.now()}`
      await wavesurferRef.current?.load(url)
      setRetempoUrl(url)
      setRetempoBpm(bpm)
      setRetempoDuration(result.duration)
      setViewMode('retempo')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRetempoing(false)
    }
  }

  function handleApplyRetempo() {
    if (!track) return
    void applyRetempo(track.track_id, targetBpm)
  }

  useImperativeHandle(ref, () => ({
    applyTempo: (bpm: number) => {
      if (!track) return
      const effectiveBpm = nearestOctaveTarget(track.bpm, bpm)
      void applyRetempo(track.track_id, effectiveBpm)
    },
  }))

  async function handleShowOriginal() {
    if (!track || viewMode === 'original') return
    await wavesurferRef.current?.load(trackAudioUrl(track.track_id))
    setViewMode('original')
  }

  async function handleShowRetempo() {
    if (!retempoUrl || viewMode === 'retempo') return
    await wavesurferRef.current?.load(retempoUrl)
    setViewMode('retempo')
  }

  return (
    <div className="track-panel">
      <div className="track-panel-header">
        <div className="track-position">
          <span>Track</span>
          <input
            type="number"
            className="position-input"
            min={1}
            max={totalTracks}
            value={positionInput}
            onChange={(e) => setPositionInput(e.target.value)}
            onBlur={commitPosition}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
        </div>
        <button type="button" className="remove-button" onClick={onRemove}>
          Remove
        </button>
      </div>

      <div className="upload-row">
        {uploading ? (
          <span className="filename">Uploading…</span>
        ) : (
          track && <span className="filename">{track.filename}</span>
        )}
      </div>

      {error && (
        <div className="error-row">
          <p className="error">{error}</p>
          {lastFile && (
            <button type="button" className="retry-button" onClick={() => uploadFile(lastFile)}>
              Retry
            </button>
          )}
        </div>
      )}

      <div ref={containerRef} className="waveform" />

      {track && (
        <>
          <div className="playback-row">
            <button
              type="button"
              className="play-button"
              onClick={() => wavesurferRef.current?.playPause()}
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            {retempoUrl && (
              <div className="ab-toggle">
                <button
                  type="button"
                  className={viewMode === 'original' ? 'active' : ''}
                  onClick={handleShowOriginal}
                >
                  Original ({track.bpm} BPM)
                </button>
                <button
                  type="button"
                  className={viewMode === 'retempo' ? 'active' : ''}
                  onClick={handleShowRetempo}
                >
                  Retempoed{retempoBpm !== null ? ` (${retempoBpm} BPM)` : ''}
                </button>
              </div>
            )}
          </div>

          <div className="stats-row">
            <div className="stat">
              <span className="stat-label">Detected BPM</span>
              <span className="stat-value">{track.bpm}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Key</span>
              <span className="stat-value">{track.key}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Duration @ {track.bpm}bpm</span>
              <span className="stat-value">{track.duration.toFixed(1)}s</span>
            </div>
            {retempoDuration !== null && (
              <div className="stat">
                <span className="stat-label">Duration @ {retempoBpm}bpm</span>
                <span className="stat-value">{retempoDuration.toFixed(1)}s</span>
              </div>
            )}
          </div>

          <div className="retempo-row">
            <label htmlFor="target-bpm">Target BPM</label>
            <input
              id="target-bpm"
              type="number"
              min={20}
              max={300}
              step={1}
              value={targetBpm}
              onChange={(e) => setTargetBpm(Number(e.target.value))}
            />
            <button type="button" onClick={handleApplyRetempo} disabled={retempoing}>
              {retempoing ? 'Rendering…' : 'Apply'}
            </button>
            {retempoUrl && (
              <span className="retempo-badge">
                {viewMode === 'retempo' ? 'viewing retempoed' : 'viewing original'}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
})
