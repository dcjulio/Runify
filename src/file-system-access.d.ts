// Minimal File System Access API types (Chromium-only) -- not yet part of
// TypeScript's bundled DOM lib. Only the shape actually used by the export
// save-as flow in App.tsx.
interface SaveFilePickerOptions {
  suggestedName?: string
  types?: {
    description?: string
    accept: Record<string, string[]>
  }[]
}

interface FileSystemWritableFileStream {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}

interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>
  remove(): Promise<void>
}

interface Window {
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>
}
