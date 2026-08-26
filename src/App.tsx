import { useRef, useState } from 'react'
import { exportMix } from './api'
import { TrackPanel, type TrackPanelHandle, type TrackStatus } from './components/TrackPanel'
import './App.css'

function App() {
  const [slots, setSlots] = useState<string[]>([])
  const [initialFiles, setInitialFiles] = useState<Record<string, File>>({})
  const [statuses, setStatuses] = useState<Record<string, TrackStatus>>({})
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [globalTargetBpm, setGlobalTargetBpm] = useState<number>(120)

  const panelRefs = useRef<Record<string, TrackPanelHandle | null>>({})

  function handleAddSongs(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    const newIds = files.map(() => crypto.randomUUID())
    setSlots((prev) => [...prev, ...newIds])
    setInitialFiles((prev) => {
      const next = { ...prev }
      newIds.forEach((id, i) => {
        next[id] = files[i]
      })
      return next
    })
    e.target.value = ''
  }

  function removeSlot(id: string) {
    setSlots((prev) => prev.filter((slotId) => slotId !== id))
    setStatuses((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    delete panelRefs.current[id]
  }

  function updateStatus(id: string, status: TrackStatus) {
    setStatuses((prev) => ({ ...prev, [id]: status }))
  }

  const readyTracks = slots
    .map((id) => statuses[id])
    .filter((s): s is TrackStatus & { trackId: string } => !!s?.trackId)

  function handleApplyToAll() {
    slots.forEach((id) => {
      panelRefs.current[id]?.applyTempo(globalTargetBpm)
    })
  }

  async function handleDownloadMix() {
    setExporting(true)
    setExportError(null)
    try {
      const blob = await exportMix(
        readyTracks.map((s) => ({ track_id: s.trackId, version: s.version })),
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'runify-mix.wav'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Runify</h1>
        <p className="subtitle">Build your running mix</p>
      </header>
      <main>
        {readyTracks.length > 0 && (
          <div className="global-tempo-row">
            <label htmlFor="global-target-bpm">Target BPM for all</label>
            <input
              id="global-target-bpm"
              type="number"
              min={20}
              max={300}
              step={1}
              value={globalTargetBpm}
              onChange={(e) => setGlobalTargetBpm(Number(e.target.value))}
            />
            <button type="button" onClick={handleApplyToAll}>
              Apply to all
            </button>
          </div>
        )}

        {slots.map((id, index) => (
          <TrackPanel
            key={id}
            ref={(el) => {
              panelRefs.current[id] = el
            }}
            index={index}
            initialFile={initialFiles[id]}
            onRemove={() => removeSlot(id)}
            onStatusChange={(status) => updateStatus(id, status)}
          />
        ))}
        <label className="add-song-button">
          + Add song(s)
          <input
            type="file"
            accept="audio/*"
            multiple
            onChange={handleAddSongs}
            hidden
          />
        </label>

        <div className="export-row">
          <button
            type="button"
            className="download-mix-button"
            onClick={handleDownloadMix}
            disabled={readyTracks.length === 0 || exporting}
          >
            {exporting ? 'Exporting…' : `Download full mix (${readyTracks.length} track${readyTracks.length === 1 ? '' : 's'})`}
          </button>
          {exportError && <p className="error">{exportError}</p>}
        </div>
      </main>
    </div>
  )
}

export default App
