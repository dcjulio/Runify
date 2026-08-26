const BASE_URL = 'http://localhost:8001'

export interface TrackInfo {
  track_id: string
  filename: string
  bpm: number
  detected_bpm: number
  key: string
  duration: number
}

export interface LibraryEntry {
  track_id: string
  filename: string
  analyzed: boolean
  bpm: number | null
  detected_bpm: number | null
  key: string | null
  duration: number | null
}

export async function listLibrary(): Promise<{ path: string; tracks: LibraryEntry[] }> {
  const res = await fetch(`${BASE_URL}/library`)
  if (!res.ok) {
    throw new Error(`Failed to list My Songs: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

export async function analyzeLibraryTrack(trackId: string): Promise<TrackInfo> {
  const res = await fetch(`${BASE_URL}/library/tracks/${trackId}/analyze`, { method: 'POST' })
  if (!res.ok) {
    throw new Error(`Couldn't analyze track: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

export async function openLibraryFolder(): Promise<void> {
  const res = await fetch(`${BASE_URL}/library/open-folder`, { method: 'POST' })
  if (!res.ok) {
    throw new Error(`Couldn't open the folder: ${res.status} ${await res.text()}`)
  }
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

export async function correctTrackBpm(
  trackId: string,
  bpm: number,
): Promise<{ track_id: string; bpm: number; detected_bpm: number }> {
  const res = await fetch(`${BASE_URL}/tracks/${trackId}/bpm`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bpm }),
  })
  if (!res.ok) {
    throw new Error(`BPM correction failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

export async function resetTrackBpm(
  trackId: string,
): Promise<{ track_id: string; bpm: number; detected_bpm: number }> {
  const res = await fetch(`${BASE_URL}/tracks/${trackId}/bpm/reset`, { method: 'POST' })
  if (!res.ok) {
    throw new Error(`BPM reset failed: ${res.status} ${await res.text()}`)
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

export interface MixTrackSpec {
  track_id: string
  filename: string
}

export async function saveMix(name: string, tracks: MixTrackSpec[]): Promise<void> {
  const res = await fetch(`${BASE_URL}/mixes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, tracks }),
  })
  if (!res.ok) {
    throw new Error(`Save mix failed: ${res.status} ${await res.text()}`)
  }
}

export async function listMixes(): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/mixes`)
  if (!res.ok) {
    throw new Error(`Failed to list saved mixes: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  return data.mixes
}

export interface LoadedMixTrack {
  track_id: string
  filename: string
  bpm: number
  detected_bpm: number
  key: string
  duration: number
}

export async function loadMix(
  name: string,
): Promise<{ name: string; tracks: LoadedMixTrack[]; missing: string[] }> {
  const res = await fetch(`${BASE_URL}/mixes/${encodeURIComponent(name)}`)
  if (!res.ok) {
    throw new Error(`Load mix failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

export async function openMixesFolder(): Promise<void> {
  const res = await fetch(`${BASE_URL}/mixes/open-folder`, { method: 'POST' })
  if (!res.ok) {
    throw new Error(`Couldn't open the folder: ${res.status} ${await res.text()}`)
  }
}
