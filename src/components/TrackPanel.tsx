import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import {
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

interface TrackPanelProps {
  index: number
  initialFile?: File
  onRemove: () => void
  onStatusChange: (status: TrackStatus) => void
}

export function TrackPanel({ index, initialFile, onRemove, onStatusChange }: TrackPanelProps) {
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

  useEffect(() => {
    onStatusChange({ trackId: track?.track_id ?? null, version: viewMode })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, viewMode])

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

  useEffect(() => {
    if (initialFile) {
      void uploadFile(initialFile)
    }
    // initialFile is only meant to seed this instance once, on creation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleApplyRetempo() {
    if (!track) return
    setRetempoing(true)
    setError(null)
    try {
      const result = await retempoTrack(track.track_id, targetBpm)
      const url = `${retempoAudioUrl(track.track_id)}?t=${Date.now()}`
      await wavesurferRef.current?.load(url)
      setRetempoUrl(url)
      setRetempoBpm(targetBpm)
      setRetempoDuration(result.duration)
      setViewMode('retempo')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRetempoing(false)
    }
  }

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
        <span className="track-number">Track {index + 1}</span>
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

      {error && <p className="error">{error}</p>}

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
}
