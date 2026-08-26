import { useEffect, useRef, useState } from 'react'
import {
  type LoadedPlaylistTrack,
  exportMix,
  listPlaylists,
  loadPlaylist,
  openPlaylistsFolder,
  savePlaylist,
} from './api'
import { TrackPanel, type TrackPanelHandle, type TrackStatus } from './components/TrackPanel'
import './App.css'

function App() {
  const [slots, setSlots] = useState<string[]>([])
  const [initialFiles, setInitialFiles] = useState<Record<string, File>>({})
  const [existingTracks, setExistingTracks] = useState<Record<string, LoadedPlaylistTrack>>({})
  const [statuses, setStatuses] = useState<Record<string, TrackStatus>>({})
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [globalTargetBpm, setGlobalTargetBpm] = useState<number>(120)

  const [playlistNames, setPlaylistNames] = useState<string[]>([])
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedPlaylist, setSelectedPlaylist] = useState('')
  const [loadingPlaylist, setLoadingPlaylist] = useState(false)
  const [playlistError, setPlaylistError] = useState<string | null>(null)

  const panelRefs = useRef<Record<string, TrackPanelHandle | null>>({})

  async function refreshPlaylistNames() {
    try {
      const names = await listPlaylists()
      setPlaylistNames(names)
    } catch {
      // non-critical, just leave the list as-is
    }
  }

  useEffect(() => {
    void refreshPlaylistNames()
  }, [])

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

  function handleApplyToAll() {
    slots.forEach((id) => {
      panelRefs.current[id]?.applyTempo(globalTargetBpm)
    })
  }

  async function handleExportMix() {
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

  async function handleSaveMix() {
    const name = saveName.trim()
    if (!name || readyTracks.length === 0) return
    setSaving(true)
    setPlaylistError(null)
    try {
      await savePlaylist(
        name,
        readyTracks.map((s) => ({ track_id: s.trackId, target_bpm: s.targetBpm, version: s.version })),
      )
      await refreshPlaylistNames()
    } catch (err) {
      setPlaylistError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleLoadMix() {
    if (!selectedPlaylist) return
    setLoadingPlaylist(true)
    setPlaylistError(null)
    try {
      const data = await loadPlaylist(selectedPlaylist)
      const newIds = data.tracks.map(() => crypto.randomUUID())
      setSlots(newIds)
      setStatuses({})
      setInitialFiles({})
      setExistingTracks(() => {
        const next: Record<string, LoadedPlaylistTrack> = {}
        newIds.forEach((id, i) => {
          next[id] = data.tracks[i]
        })
        return next
      })
    } catch (err) {
      setPlaylistError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingPlaylist(false)
    }
  }

  async function handleOpenPlaylistsFolder() {
    setPlaylistError(null)
    try {
      await openPlaylistsFolder()
    } catch (err) {
      setPlaylistError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Runify</h1>
        <p className="subtitle">Build your running mix</p>
      </header>
      <main>
        <div className="playlist-row">
          <div className="playlist-save">
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
          <div className="playlist-load">
            <select
              value={selectedPlaylist}
              onChange={(e) => setSelectedPlaylist(e.target.value)}
            >
              <option value="">
                {playlistNames.length === 0 ? 'No saved mixes' : 'Choose a saved mix…'}
              </option>
              {playlistNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleLoadMix}
              disabled={!selectedPlaylist || loadingPlaylist}
            >
              {loadingPlaylist ? 'Loading…' : 'Load mix'}
            </button>
            <button
              type="button"
              className="open-folder-button"
              onClick={handleOpenPlaylistsFolder}
              title="Open the folder where mixes are saved"
            >
              Open folder
            </button>
          </div>
        </div>
        {playlistError && <p className="error">{playlistError}</p>}

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
            totalTracks={slots.length}
            initialFile={initialFiles[id]}
            existingTrack={existingTracks[id]}
            onRemove={() => removeSlot(id)}
            onMove={(newPosition) => moveSlot(id, newPosition)}
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
            onClick={handleExportMix}
            disabled={readyTracks.length === 0 || exporting}
          >
            {exporting ? 'Exporting…' : `Export mix (${readyTracks.length} track${readyTracks.length === 1 ? '' : 's'})`}
          </button>
          {exportError && <p className="error">{exportError}</p>}
        </div>
      </main>
    </div>
  )
}

export default App
