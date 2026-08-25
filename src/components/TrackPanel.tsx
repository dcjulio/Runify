import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import {
  type TrackInfo,
  retempoAudioUrl,
  retempoTrack,
  trackAudioUrl,
  uploadTrack,
} from '../api'

export function TrackPanel() {
  const [track, setTrack] = useState<TrackInfo | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [targetBpm, setTargetBpm] = useState<number>(0)
  const [retempoing, setRetempoing] = useState(false)
  const [isRetempoed, setIsRetempoed] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)

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

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)
    setIsRetempoed(false)
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

  async function handleApplyRetempo() {
    if (!track) return
    setRetempoing(true)
    setError(null)
    try {
      await retempoTrack(track.track_id, targetBpm)
      const url = `${retempoAudioUrl(track.track_id)}?t=${Date.now()}`
      await wavesurferRef.current?.load(url)
      setIsRetempoed(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRetempoing(false)
    }
  }

  async function handleResetToOriginal() {
    if (!track) return
    await wavesurferRef.current?.load(trackAudioUrl(track.track_id))
    setIsRetempoed(false)
  }

  return (
    <div className="track-panel">
      <div className="upload-row">
        <label className="upload-button">
          {uploading ? 'Uploading…' : 'Choose a song'}
          <input
            type="file"
            accept="audio/*"
            onChange={handleFileChange}
            disabled={uploading}
            hidden
          />
        </label>
        {track && <span className="filename">{track.filename}</span>}
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
            {isRetempoed && (
              <button type="button" className="reset-button" onClick={handleResetToOriginal}>
                Back to original
              </button>
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
              <span className="stat-label">Duration</span>
              <span className="stat-value">{track.duration.toFixed(1)}s</span>
            </div>
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
            {isRetempoed && <span className="retempo-badge">retempoed</span>}
          </div>
        </>
      )}
    </div>
  )
}
