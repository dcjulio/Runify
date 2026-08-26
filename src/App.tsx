import { useEffect, useRef, useState } from 'react'
import {
  type LibraryEntry,
  type LoadedPlaylistTrack,
  exportMix,
  listLibrary,
  listPlaylists,
  loadPlaylist,
  openLibraryFolder,
  openPlaylistsFolder,
  savePlaylist,
} from './api'
import { TrackPanel, type TrackPanelHandle, type TrackStatus } from './components/TrackPanel'
import { formatDuration } from './utils'
import './App.css'

function App() {
  const [slots, setSlots] = useState<string[]>([])
  const [initialLibraryTrackIds, setInitialLibraryTrackIds] = useState<Record<string, string>>({})
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
  const [missingTracks, setMissingTracks] = useState<string[]>([])

  const [libraryPath, setLibraryPath] = useState('')
  const [libraryEntries, setLibraryEntries] = useState<LibraryEntry[]>([])
  const [libraryError, setLibraryError] = useState<string | null>(null)

  const panelRefs = useRef<Record<string, TrackPanelHandle | null>>({})

  async function refreshPlaylistNames() {
    try {
      const names = await listPlaylists()
      setPlaylistNames(names)
    } catch {
      // non-critical, just leave the list as-is
    }
  }

  async function refreshLibrary() {
    try {
      const data = await listLibrary()
      setLibraryPath(data.path)
      setLibraryEntries(data.tracks)
      setLibraryError(null)
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void refreshPlaylistNames()
    void refreshLibrary()
  }, [])

  function handleAddFromLibrary(trackId: string) {
    const newId = crypto.randomUUID()
    setSlots((prev) => [...prev, newId])
    setInitialLibraryTrackIds((prev) => ({ ...prev, [newId]: trackId }))
  }

  async function handleOpenLibraryFolder() {
    setLibraryError(null)
    try {
      await openLibraryFolder()
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : String(err))
    }
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
        readyTracks.map((s) => ({ track_id: s.trackId, filename: s.filename ?? s.trackId })),
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
    setMissingTracks([])
    try {
      const data = await loadPlaylist(selectedPlaylist)
      const newIds = data.tracks.map(() => crypto.randomUUID())
      setSlots(newIds)
      setStatuses({})
      setInitialLibraryTrackIds({})
      setExistingTracks(() => {
        const next: Record<string, LoadedPlaylistTrack> = {}
        newIds.forEach((id, i) => {
          next[id] = data.tracks[i]
        })
        return next
      })
      setMissingTracks(data.missing)
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
              Open source folder
            </button>
          </div>
        </div>
        {playlistError && <p className="error">{playlistError}</p>}
        {missingTracks.length > 0 && (
          <p className="mix-warning">
            {missingTracks.length} song{missingTracks.length === 1 ? '' : 's'} from this mix
            couldn't be found in My Songs (moved, renamed, or deleted): {missingTracks.join(', ')}
          </p>
        )}

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
            initialLibraryTrackId={initialLibraryTrackIds[id]}
            existingTrack={existingTracks[id]}
            onRemove={() => removeSlot(id)}
            onMove={(newPosition) => moveSlot(id, newPosition)}
            onStatusChange={(status) => updateStatus(id, status)}
          />
        ))}

        <div className="library-panel">
          <div className="library-header">
            <h2>My Songs</h2>
            <button type="button" onClick={() => void refreshLibrary()}>
              Refresh
            </button>
          </div>
          {libraryError && <p className="error">{libraryError}</p>}
          {libraryEntries.length > 0 && (
            <ul className="library-list">
              {libraryEntries.map((entry) => (
                <li key={entry.track_id} className="library-item">
                  <span className="library-filename">{entry.filename}</span>
                  {entry.analyzed && entry.bpm !== null && (
                    <span className="library-meta">
                      {Math.round(entry.bpm)} BPM · {entry.key}
                    </span>
                  )}
                  <button type="button" onClick={() => handleAddFromLibrary(entry.track_id)}>
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="add-song-button"
            onClick={handleOpenLibraryFolder}
            title={libraryPath || 'Open the folder where your music lives'}
          >
            + Add songs
          </button>
          <p className="library-hint">
            Drop your downloaded music into the My Songs folder (subfolders are fine too), then
            hit Refresh to see it above.
          </p>
        </div>

        <div className="export-row">
          <button
            type="button"
            className="download-mix-button"
            onClick={handleExportMix}
            disabled={readyTracks.length === 0 || exporting}
          >
            {exporting
              ? 'Exporting…'
              : `Export mix (${readyTracks.length} track${readyTracks.length === 1 ? '' : 's'}, ${formatDuration(totalDuration)})`}
          </button>
          {exportError && <p className="error">{exportError}</p>}
        </div>
      </main>
    </div>
  )
}

export default App
