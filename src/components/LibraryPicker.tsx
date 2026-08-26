import { useEffect, useMemo, useState } from 'react'
import { type LibraryEntry, listLibrary, openLibraryFolder } from '../api'

interface LibraryPickerProps {
  onClose: () => void
  onPick: (trackId: string) => void
}

interface TreeNode {
  folders: Map<string, TreeNode>
  files: LibraryEntry[]
}

function buildTree(entries: LibraryEntry[]): TreeNode {
  const root: TreeNode = { folders: new Map(), files: [] }
  for (const entry of entries) {
    const parts = entry.filename.split(/[\\/]+/).filter(Boolean)
    const fileName = parts.pop() ?? entry.filename
    let node = root
    for (const part of parts) {
      let child = node.folders.get(part)
      if (!child) {
        child = { folders: new Map(), files: [] }
        node.folders.set(part, child)
      }
      node = child
    }
    node.files.push({ ...entry, filename: fileName })
  }
  return root
}

function getNode(root: TreeNode, path: string[]): TreeNode | null {
  let node = root
  for (const part of path) {
    const next = node.folders.get(part)
    if (!next) return null
    node = next
  }
  return node
}

export function LibraryPicker({ onClose, onPick }: LibraryPickerProps) {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [libraryPath, setLibraryPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [currentPath, setCurrentPath] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const data = await listLibrary()
      setLibraryPath(data.path)
      setEntries(data.tracks)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  async function handleOpenFolder() {
    setError(null)
    try {
      await openLibraryFolder()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const tree = useMemo(() => buildTree(entries), [entries])
  const node = getNode(tree, currentPath) ?? { folders: new Map(), files: [] }
  const folderNames = [...node.folders.keys()].sort((a, b) => a.localeCompare(b))
  const files = [...node.files].sort((a, b) => a.filename.localeCompare(b.filename))

  function toggleSelected(trackId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(trackId)) {
        next.delete(trackId)
      } else {
        next.add(trackId)
      }
      return next
    })
  }

  function handleOpenSelected() {
    selected.forEach((trackId) => onPick(trackId))
    onClose()
  }

  function handleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      files.forEach((entry) => next.add(entry.track_id))
      return next
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>My Songs</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="add-song-hint">
          Drop your downloaded music into the My Songs folder (subfolders are fine too), then hit
          Refresh.
        </p>

        <div className="modal-actions">
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="open-folder-button"
            onClick={handleOpenFolder}
            title={libraryPath || 'Open the folder where your music lives'}
          >
            Open My Songs folder
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="modal-path-row">
          <button
            type="button"
            className="modal-back-button"
            onClick={() => setCurrentPath((p) => p.slice(0, -1))}
            disabled={currentPath.length === 0}
          >
            ‹ Back
          </button>
          <span className="modal-path">
            My Songs{currentPath.length > 0 ? ` / ${currentPath.join(' / ')}` : ''}
          </span>
          <button
            type="button"
            className="modal-select-all-button"
            onClick={handleSelectAll}
            disabled={files.length === 0}
          >
            Select all
          </button>
        </div>

        {folderNames.length === 0 && files.length === 0 ? (
          <p className="library-empty">
            {currentPath.length === 0
              ? 'No songs found yet. Drop some into the My Songs folder, then hit Refresh.'
              : 'Nothing in this folder.'}
          </p>
        ) : (
          <ul className="library-list">
            {folderNames.map((name) => (
              <li
                key={`folder-${name}`}
                className="library-item library-folder"
                onClick={() => setCurrentPath((p) => [...p, name])}
              >
                <span className="library-filename">{name}</span>
                <span className="library-folder-chevron">›</span>
              </li>
            ))}
            {files.map((entry) => (
              <li key={entry.track_id} className="library-item">
                <input
                  type="checkbox"
                  checked={selected.has(entry.track_id)}
                  onChange={() => toggleSelected(entry.track_id)}
                />
                <span className="library-filename">{entry.filename}</span>
                {entry.analyzed && entry.bpm !== null && (
                  <span className="library-meta">
                    {Math.round(entry.bpm)} BPM · {entry.key}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="modal-footer">
          <span className="modal-selection-count">
            {selected.size} song{selected.size === 1 ? '' : 's'} selected
          </span>
          <button
            type="button"
            className="modal-open-button"
            onClick={handleOpenSelected}
            disabled={selected.size === 0}
          >
            Open
          </button>
        </div>
      </div>
    </div>
  )
}
