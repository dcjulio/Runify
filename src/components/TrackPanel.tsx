import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import {
  type LoadedPlaylistTrack,
  type TrackInfo,
  type TrackVersion,
  correctTrackBpm,
  resetTrackBpm,
  retempoAudioUrl,
  retempoTrack,
  trackAudioUrl,
  uploadTrack,
} from '../api'
import { formatDuration } from '../utils'

export interface TrackStatus {
  trackId: string | null
  version: TrackVersion
  duration: number | null
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

// BPM numbers are always shown rounded -- sub-BPM precision isn't
// meaningful to look at, even though the underlying values (what's sent
// to the backend for retempo ratios etc.) stay precise.
function formatBpm(n: number): number {
  return Math.round(n)
}

type BpmJumpSeverity = 'none' | 'mild' | 'strong'

// Time-stretch artifacts scale with percentage change, not raw BPM count.
// Thresholds are a starting point, not a hard science -- adjust if they
// feel wrong in practice.
function bpmJumpSeverity(originalBpm: number, targetBpm: number): BpmJumpSeverity {
  if (!originalBpm || originalBpm <= 0) return 'none'
  const pct = (Math.abs(targetBpm - originalBpm) / originalBpm) * 100
  if (pct >= 25) return 'strong'
  if (pct >= 10) return 'mild'
  return 'none'
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
  const [bpmInput, setBpmInput] = useState('')

  useEffect(() => {
    const duration =
      viewMode === 'retempo' && retempoDuration !== null ? retempoDuration : (track?.duration ?? null)
    onStatusChange({ trackId: track?.track_id ?? null, version: viewMode, duration })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, viewMode, retempoDuration])

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

  useEffect(() => {
    if (track) setBpmInput(String(formatBpm(track.bpm)))
  }, [track])

  async function commitBpmCorrection() {
    if (!track) return
    const n = Number.parseFloat(bpmInput)
    if (!Number.isFinite(n) || n <= 0) {
      setBpmInput(String(formatBpm(track.bpm)))
      return
    }
    // Compare against the same rounded baseline the field displays, not
    // the raw precise value -- otherwise just clicking into the field and
    // out again (without changing anything) would look like a real edit
    // and silently submit a correction to the rounded number.
    if (n === formatBpm(track.bpm)) return

    setError(null)
    try {
      await correctTrackBpm(track.track_id, n)
      setTrack({ ...track, bpm: n })
      // any existing retempo render was computed against the old (now
      // wrong) reference tempo -- the backend already discarded it, so
      // drop it here too rather than leave a stale view/url around
      setRetempoUrl(null)
      setRetempoBpm(null)
      setRetempoDuration(null)
      setViewMode('original')
      await wavesurferRef.current?.load(trackAudioUrl(track.track_id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBpmInput(String(formatBpm(track.bpm)))
    }
  }

  async function handleResetBpm() {
    if (!track) return
    setError(null)
    try {
      const result = await resetTrackBpm(track.track_id)
      setTrack({ ...track, bpm: result.bpm })
      setRetempoUrl(null)
      setRetempoBpm(null)
      setRetempoDuration(null)
      setViewMode('original')
      await wavesurferRef.current?.load(trackAudioUrl(track.track_id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
      setTargetBpm(formatBpm(info.bpm))
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
      detected_bpm: t.detected_bpm,
      key: t.key,
      duration: t.duration,
    }
    setTrack(info)
    setTargetBpm(formatBpm(t.bpm))
    await wavesurferRef.current?.load(trackAudioUrl(t.track_id))
  }

  const seededRef = useRef(false)

  useEffect(() => {
    // StrictMode (see main.tsx) deliberately mounts, unmounts, and
    // remounts every component once in dev -- including the wavesurfer
    // instance itself (created in the effect above): a first instance gets
    // created, destroyed, then a second one created, all synchronously, as
    // a dev-mode check. If loading a track starts inside that same
    // synchronous window, it targets whichever instance existed at that
    // exact moment -- which can be the first one, right before it's
    // destroyed, leaving the surviving instance with nothing loaded (no
    // waveform, unplayable). A zero-delay timer defers the actual load
    // until after that synchronous dance has fully settled, so it always
    // targets the instance that actually survives.
    //
    // The seededRef guard (refs survive the simulated cycle) still makes
    // sure only one of the two setup passes schedules anything at all.
    if (seededRef.current) return
    seededRef.current = true

    setTimeout(() => {
      if (initialFile) {
        void uploadFile(initialFile)
      } else if (existingTrack) {
        void hydrateExisting(existingTrack)
      }
    }, 0)
    // initialFile/existingTrack are only meant to seed this instance once,
    // on creation -- a given slot is always exactly one of "new upload" or
    // "loaded from a saved mix", never both, never changing after mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function applyRetempo(trackId: string, bpm: number) {
    // bpm stays precise for the actual API call (the stretch ratio); only
    // the displayed target updates to the rounded value.
    setTargetBpm(formatBpm(bpm))
    setRetempoing(true)
    setError(null)
    try {
      const result = await retempoTrack(trackId, bpm)
      const url = `${retempoAudioUrl(trackId)}?t=${Date.now()}`
      await wavesurferRef.current?.load(url)
      setRetempoUrl(url)
      setRetempoBpm(formatBpm(bpm))
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
                  Original ({formatBpm(track.bpm)} BPM)
                </button>
                <button
                  type="button"
                  className={viewMode === 'retempo' ? 'active' : ''}
                  onClick={handleShowRetempo}
                >
                  Retempoed{retempoBpm !== null ? ` (${formatBpm(retempoBpm)} BPM)` : ''}
                </button>
              </div>
            )}
          </div>

          <div className="stats-row">
            <div className="stat">
              <span className="stat-label">Detected BPM: {formatBpm(track.detected_bpm)}</span>
              <div className="bpm-value-row">
                <input
                  type="number"
                  className={`bpm-correction-input${track.bpm !== track.detected_bpm ? ' corrected' : ''}`}
                  min={20}
                  max={300}
                  step={1}
                  value={bpmInput}
                  onChange={(e) => setBpmInput(e.target.value)}
                  onBlur={commitBpmCorrection}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                  title="Click to correct if it sounds wrong"
                />
                {track.bpm !== track.detected_bpm && (
                  <button
                    type="button"
                    className="reset-bpm-button"
                    onClick={handleResetBpm}
                    title={`Reset to the automatically detected value: ${formatBpm(track.detected_bpm)} BPM`}
                  >
                    ↺
                  </button>
                )}
              </div>
            </div>
            <div className="stat">
              <span className="stat-label">Key</span>
              <span className="stat-value">{track.key}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Duration @ {formatBpm(track.bpm)} bpm</span>
              <span className="stat-value">{formatDuration(track.duration)}</span>
            </div>
            {retempoDuration !== null && retempoBpm !== null && (
              <div className="stat">
                <span className="stat-label">Duration @ {formatBpm(retempoBpm)} bpm</span>
                <span className="stat-value">{formatDuration(retempoDuration)}</span>
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
            {(() => {
              const severity = bpmJumpSeverity(track.bpm, targetBpm)
              if (severity === 'none') return null
              const pct = Math.round((Math.abs(targetBpm - track.bpm) / track.bpm) * 100)
              return <span className={`bpm-warning ${severity}`}>⚠ {pct}% jump</span>
            })()}
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
