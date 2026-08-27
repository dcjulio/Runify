# Project notes (for Claude)

This file is the durable record of what Runify is and where the work stands.
It lives in the repo (not in Claude's directory-keyed memory) so it survives
renames, moves, and new machines. Update it as the project evolves — treat it
as a living doc, not a one-time snapshot.

## What Runify is

A local tool for building a running mix from your own downloaded music: drop
songs into a `My Songs` folder, pick them in the app, see their BPM/key,
retempo them to match, drag transition points on the waveform, and export the
whole queue as one continuous audio file. Everything runs locally — nothing
is uploaded anywhere. See [README.md](README.md) for setup/run instructions.

## Architecture

- **`backend/`** — Python (FastAPI), port 8001. Audio work: decoding, BPM/key
  detection (librosa), time-stretching, crossfade mixing, final render.
  - `app/main.py` — API routes
  - `app/analysis.py` — BPM/key detection, audio analysis
  - `app/storage.py` — reading from / writing to `My Songs`, saved mixes
- **root** — React + TypeScript (Vite), port 5173. Interactive UI.
  - `src/App.tsx` — main app state/orchestration
  - `src/components/LibraryPicker.tsx` — Explorer-style song picker
  - `src/components/TrackPanel.tsx` — per-track waveform, BPM/key display,
    transition markers
  - `src/api.ts` — talks to the backend

## Working agreement

The collaboration rules (ask before changing code, commit = commit+push,
Claude co-author trailer) live in [CLAUDE.md](CLAUDE.md) and are
auto-loaded every session — no need to duplicate them here.

## Where things stand (updated 2026-08-27)

Most recent work, newest first:
- `setup.bat` for one-click first-time setup (checks/installs Python, Node,
  ffmpeg via winget); native Save As dialog on export; export is blocked
  while the apply-to-all queue is running
- Sticky picker footer, sequential apply-to-all queue, FLAC export option
- Explorer-style song picker, orange accent theme, renamed "playlist" to "mix"
  throughout the UI
- Replaced browser file upload with the local `My Songs` folder as the
  source of truth (no duplication when re-picking a song)
- BPM correction UI: editable field, highlights purple once corrected, can
  reset to the originally detected value; target BPM stays in sync
- Duration formatting (mm:ss, handles hours), total mix time shown
- Fixed a React StrictMode double-init race that broke waveform/playback on
  loaded tracks

No open bugs or in-progress threads are currently tracked — the backlog is
whatever comes up in conversation next. When we start a multi-step effort,
add a "Next up" section here with the plan so it survives context resets.

## History note

The project directory was originally `Runify-my-music` and was renamed to
`Runify` on 2026-08-27. Claude's memory system is keyed by directory path, so
a rename orphans old memory — this file exists specifically to not depend on
that.
