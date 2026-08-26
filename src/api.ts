const BASE_URL = 'http://localhost:8001'

export interface TrackInfo {
  track_id: string
  filename: string
  bpm: number
  key: string
  duration: number
}

export async function uploadTrack(file: File): Promise<TrackInfo> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE_URL}/tracks`, { method: 'POST', body: form })
  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

export function trackAudioUrl(trackId: string): string {
  return `${BASE_URL}/tracks/${trackId}/audio`
}

export function retempoAudioUrl(trackId: string): string {
  return `${BASE_URL}/tracks/${trackId}/retempo/audio`
}

export async function retempoTrack(
  trackId: string,
  targetBpm: number,
): Promise<{ track_id: string; target_bpm: number; duration: number }> {
  const res = await fetch(`${BASE_URL}/tracks/${trackId}/retempo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_bpm: targetBpm }),
  })
  if (!res.ok) {
    throw new Error(`Retempo failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

export type TrackVersion = 'original' | 'retempo'

export interface ExportTrackSpec {
  track_id: string
  version: TrackVersion
}

export async function exportMix(tracks: ExportTrackSpec[]): Promise<Blob> {
  const res = await fetch(`${BASE_URL}/mix/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tracks }),
  })
  if (!res.ok) {
    throw new Error(`Export failed: ${res.status} ${await res.text()}`)
  }
  return res.blob()
}

export interface PlaylistTrackSpec {
  track_id: string
  target_bpm: number | null
  version: TrackVersion
}

export async function savePlaylist(name: string, tracks: PlaylistTrackSpec[]): Promise<void> {
  const res = await fetch(`${BASE_URL}/playlists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, tracks }),
  })
  if (!res.ok) {
    throw new Error(`Save mix failed: ${res.status} ${await res.text()}`)
  }
}

export async function listPlaylists(): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/playlists`)
  if (!res.ok) {
    throw new Error(`Failed to list saved mixes: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  return data.playlists
}

export interface LoadedPlaylistTrack {
  track_id: string
  target_bpm: number | null
  version: TrackVersion
  filename: string
  bpm: number
  key: string
  duration: number
}

export async function loadPlaylist(
  name: string,
): Promise<{ name: string; tracks: LoadedPlaylistTrack[] }> {
  const res = await fetch(`${BASE_URL}/playlists/${encodeURIComponent(name)}`)
  if (!res.ok) {
    throw new Error(`Load mix failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}
