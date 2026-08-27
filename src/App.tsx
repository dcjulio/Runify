import { useEffect, useRef, useState } from 'react'
import {
  type ExportFormat,
  type LoadedMixTrack,
  exportMix,
  listMixes,
  loadMix,
  openMixesFolder,
  saveMix,
} from './api'
import { LibraryPicker } from './components/LibraryPicker'
import { TrackPanel, type TrackPanelHandle, type TrackStatus } from './components/TrackPanel'
import { estimateExportSeconds, formatDuration } from './utils'
import './App.css'

function App() {
  const [slots, setSlots] = useState<string[]>([])
  const [initialLibraryTrackIds, setInitialLibraryTrackIds] = useState<Record<string, string>>({})
  const [existingTracks, setExistingTracks] = useState<Record<string, LoadedMixTrack>>({})
  const [statuses, setStatuses] = useState<Record<string, TrackStatus>>({})
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportSuccess, setExportSuccess] = useState(false)
  const [exportElapsed, setExportElapsed] = useState(0)
  const [exportEstimate, setExportEstimate] = useState(0)
  const exportTimerRef = useRef<number | null>(null)
  const exportSuccessTimerRef = useRef<number | null>(null)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('flac')
  const [globalTargetBpm, setGlobalTargetBpm] = useState<number>(120)
  const [applyingAll, setApplyingAll] = useState(false)
  const [queuedSlots, setQueuedSlots] = useState<Set<string>>(new Set())

  const [mixNames, setMixNames] = useState<string[]>([])
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedMix, setSelectedMix] = useState('')
  const [loadingMix, setLoadingMix] = useState(false)
  const [mixError, setMixError] = useState<string | null>(null)
  const [missingTracks, setMissingTracks] = useState<string[]>([])

  const [showLibraryPicker, setShowLibraryPicker] = useState(false)

  const panelRefs = useRef<Record<string, TrackPanelHandle | null>>({})

  async function refreshMixNames() {
    try {
      const names = await listMixes()
      setMixNames(names)
    } catch {
      // non-critical, just leave the list as-is
    }
  }

  useEffect(() => {
    void refreshMixNames()
  }, [])

  function handleAddFromLibrary(trackId: string) {
    const newId = crypto.randomUUID()
    setSlots((prev) => [...prev, newId])
    setInitialLibraryTrackIds((prev) => ({ ...prev, [newId]: trackId }))
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

  function moveSlot(id: string, newPosition: number) {
    setSlots((prev) => {
      const currentIndex = prev.indexOf(id)
      if (currentIndex === -1) return prev
      const target = Math.min(Math.max(newPosition, 1), prev.length) - 1
      if (target === currentIndex) return prev
      const next = [...prev]
      next.splice(currentIndex, 1)
      next.splice(target, 0, id)
      return next
    })
  }

  const readyTracks = slots
    .map((id) => statuses[id])
    .filter((s): s is TrackStatus & { trackId: string } => !!s?.trackId)

  const totalDuration = readyTracks.reduce((sum, s) => sum + (s.duration ?? 0), 0)

  async function handleApplyToAll() {
    setApplyingAll(true)
    setQueuedSlots(new Set(slots))
    try {
      for (const id of slots) {
        setQueuedSlots((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        await panelRefs.current[id]?.applyTempo(globalTargetBpm)
      }
    } finally {
      setApplyingAll(false)
      setQueuedSlots(new Set())
    }
  }

  async function handleExportMix() {
    setExporting(true)
    setExportError(null)
    setExportSuccess(false)
    if (exportSuccessTimerRef.current !== null) {
      window.clearTimeout(exportSuccessTimerRef.current)
      exportSuccessTimerRef.current = null
    }
    setExportElapsed(0)
    setExportEstimate(estimateExportSeconds(totalDuration, exportFormat))
    const startedAt = Date.now()
    exportTimerRef.current = window.setInterval(() => {
      setExportElapsed(Math.round((Date.now() - startedAt) / 1000))
    }, 1000)

    const suggestedName = `runify-mix.${exportFormat}`
    let handle: FileSystemFileHandle | undefined
    try {
      const showSaveFilePicker = window.showSaveFilePicker
      if (showSaveFilePicker) {
        // Must happen before any await -- Chromium only allows this while
        // still inside the click's "user activation" window, so grab the
        // handle first and write to it once the export actually finishes.
        // Firefox/Safari (no showSaveFilePicker) fall through to the plain
        // download below.
        handle = await showSaveFilePicker({
          suggestedName,
          types: [
            {
              description: exportFormat.toUpperCase(),
              accept: { [`audio/${exportFormat}`]: [`.${exportFormat}`] },
            },
          ],
        })
      }

      const blob = await exportMix(
        readyTracks.map((s) => ({ track_id: s.trackId, version: s.version })),
        exportFormat,
      )

      if (handle) {
        const writable = await handle.createWritable()
        await writable.write(blob)
        await writable.close()
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = suggestedName
        a.click()
        URL.revokeObjectURL(url)
      }
      setExportSuccess(true)
      exportSuccessTimerRef.current = window.setTimeout(() => setExportSuccess(false), 60000)
    } catch (err) {
      // the user clicking "Cancel" on the save dialog throws this -- not a
      // real error, so don't show it as one
      if (err instanceof DOMException && err.name === 'AbortError') return
      // picker succeeded but the export itself failed -- clean up the empty
      // file it already created at the chosen location
      if (handle) {
        await handle.remove().catch(() => {})
      }
      setExportError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
      if (exportTimerRef.current !== null) {
        window.clearInterval(exportTimerRef.current)
        exportTimerRef.current = null
      }
    }
  }

  async function handleSaveMix() {
    const name = saveName.trim()
    if (!name || readyTracks.length === 0) return
    setSaving(true)
    setMixError(null)
    try {
      await saveMix(
        name,
        readyTracks.map((s) => ({ track_id: s.trackId, filename: s.filename ?? s.trackId })),
      )
      await refreshMixNames()
    } catch (err) {
      setMixError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleLoadMix() {
    if (!selectedMix) return
    setLoadingMix(true)
    setMixError(null)
    setMissingTracks([])
    try {
      const data = await loadMix(selectedMix)
      const newIds = data.tracks.map(() => crypto.randomUUID())
      setSlots(newIds)
      setStatuses({})
      setInitialLibraryTrackIds({})
      setExistingTracks(() => {
        const next: Record<string, LoadedMixTrack> = {}
        newIds.forEach((id, i) => {
          next[id] = data.tracks[i]
        })
        return next
      })
      setMissingTracks(data.missing)
    } catch (err) {
      setMixError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingMix(false)
    }
  }

  async function handleOpenMixesFolder() {
    setMixError(null)
    try {
      await openMixesFolder()
    } catch (err) {
      setMixError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Runify</h1>
        <p className="subtitle">Build your running mix</p>
      </header>
      <main>
        <div className="mix-row">
          <div className="mix-save">
            <input
              type="text"
              placeholder="Mix name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
            />
            <button
              type="button"
              onClick={handleSaveMix}
              disabled={!saveName.trim() || readyTracks.length === 0 || saving}
            >
              {saving ? 'Saving…' : 'Save mix'}
            </button>
          </div>
          <div className="mix-load">
            <select value={selectedMix} onChange={(e) => setSelectedMix(e.target.value)}>
              <option value="">
                {mixNames.length === 0 ? 'No saved mixes' : 'Choose a saved mix…'}
              </option>
              {mixNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button type="button" onClick={handleLoadMix} disabled={!selectedMix || loadingMix}>
              {loadingMix ? 'Loading…' : 'Load mix'}
            </button>
            <button
              type="button"
              className="open-folder-button"
              onClick={handleOpenMixesFolder}
              title="Open the folder where mixes are saved"
            >
              Open mix folder
            </button>
          </div>
        </div>
        {mixError && <p className="error">{mixError}</p>}
        {missingTracks.length > 0 && (
          <p className="mix-warning">
            {missingTracks.length} song{missingTracks.length === 1 ? '' : 's'} from this mix
            couldn't be found in My Songs (moved, renamed, or deleted): {missingTracks.join(', ')}
          </p>
        )}

        <button type="button" className="add-song-button" onClick={() => setShowLibraryPicker(true)}>
          + Add song(s)
        </button>
        {showLibraryPicker && (
          <LibraryPicker
            onClose={() => setShowLibraryPicker(false)}
            onPick={handleAddFromLibrary}
          />
        )}

        <div className="export-row">
          <button
            type="button"
            className="download-mix-button"
            onClick={handleExportMix}
            disabled={readyTracks.length === 0 || exporting || applyingAll}
          >
            {exporting
              ? `Exporting… ${exportElapsed}s`
              : applyingAll
                ? 'Waiting for queue…'
                : `Export mix (${readyTracks.length} track${readyTracks.length === 1 ? '' : 's'}, ${formatDuration(totalDuration)})`}
          </button>
          {exporting && (
            <span className="export-progress-hint">
              est. ~{exportEstimate}s total
            </span>
          )}
          {exportSuccess && <p className="export-success">Export successful.</p>}
          <div className="export-format-row">
            <div className="export-format-toggle">
              <button
                type="button"
                className={exportFormat === 'flac' ? 'active' : ''}
                onClick={() => setExportFormat('flac')}
              >
                FLAC
              </button>
              <button
                type="button"
                className={exportFormat === 'wav' ? 'active' : ''}
                onClick={() => setExportFormat('wav')}
              >
                WAV
              </button>
            </div>
            <span className="export-format-hint">
              {exportFormat === 'flac'
                ? 'Lossless, faster export.'
                : 'Maximum compatibility with older players.'}
            </span>
          </div>
          {exportError && <p className="error">{exportError}</p>}
        </div>

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
            <button type="button" onClick={() => void handleApplyToAll()} disabled={applyingAll}>
              {applyingAll ? 'Applying…' : 'Apply to all'}
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
            totalTracks={slots.length}
            initialLibraryTrackId={initialLibraryTrackIds[id]}
            existingTrack={existingTracks[id]}
            queued={queuedSlots.has(id)}
            applyDisabled={applyingAll}
            onRemove={() => removeSlot(id)}
            onMove={(newPosition) => moveSlot(id, newPosition)}
            onStatusChange={(status) => updateStatus(id, status)}
          />
        ))}
      </main>
    </div>
  )
}

export default App
