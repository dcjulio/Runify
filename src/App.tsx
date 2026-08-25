import { useState } from 'react'
import { exportMix } from './api'
import { TrackPanel, type TrackStatus } from './components/TrackPanel'
import './App.css'

function App() {
  const [slots, setSlots] = useState<string[]>([crypto.randomUUID()])
  const [statuses, setStatuses] = useState<Record<string, TrackStatus>>({})
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  function addSlot() {
    setSlots((prev) => [...prev, crypto.randomUUID()])
  }

  function removeSlot(id: string) {
    setSlots((prev) => prev.filter((slotId) => slotId !== id))
    setStatuses((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function updateStatus(id: string, status: TrackStatus) {
    setStatuses((prev) => ({ ...prev, [id]: status }))
  }

  const readyTracks = slots
    .map((id) => statuses[id])
    .filter((s): s is TrackStatus & { trackId: string } => !!s?.trackId)

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
        {slots.map((id, index) => (
          <TrackPanel
            key={id}
            index={index}
            onRemove={() => removeSlot(id)}
            onStatusChange={(status) => updateStatus(id, status)}
          />
        ))}
        <button type="button" className="add-song-button" onClick={addSlot}>
          + Add another song
        </button>

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
