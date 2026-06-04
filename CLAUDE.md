# ReVid

Local-first desktop video viewer, editor, and "theater" for online courses. Sibling of RePic (images).

## Stack
- Electron 31 (shell) + React 19 + Vite 6
- Tailwind CSS v4 (`@tailwindcss/vite`)
- Plyr (video player), ffmpeg-static (all video processing via spawned ffmpeg)
- No TypeScript — plain `.jsx` / `.cjs`. No test framework configured.
- Entry: `electron/main.cjs` (main process) loads Vite dev server (`localhost:3001`) or `dist/`; renderer entry `src/main.jsx` → `src/App.jsx`

## Directory structure

```
electron/
  main.cjs       ← Main process: BrowserWindow, local-video:// protocol, all ffmpeg IPC handlers, mini-player, upload, .revid files
  preload.cjs    ← contextBridge → window.electronAPI (IPC surface, fs helpers, path)
  start.cjs      ← Dev launcher: spawns electron pointing at project root
src/
  App.jsx        ← Root: toolbar, 3 view modes (grid / viewer / theater), wires all dialogs (~1900 lines)
  main.jsx       ← React root; theme.jsx + i18n.jsx providers
  components/    ← Grid, sidebar, filmstrip, thumbnail bars, + *Dialog.jsx tool dialogs (Screenshot, Gif, Compress, Audio, Speed, BatchCrop, BatchRename, Concat)
  components/icons/ ← Inline SVG icon components
  features/
    viewer/      ← VideoViewer (single-video Plyr playback)
    editor/      ← VideoEditor + CropOverlay + TrimTimeline (spatial crop / trim)
    mini-player/ ← Floating always-on-top mini player window
    theater/     ← Online course viewer: webview/YouTube playback, folders, upload, export, progress tracking
  hooks/         ← useVideoFileSystem, useKeyboardNav, useSortFilter, usePins, usePlaybackSpeed, useWebTheater, useYouTubePlayer
  utils/         ← revidFile (validation), videoMetadata, videoThumbnails, youtubeUrl, platformDetect, webviewVideoDetector
docs/FEATURE-PLAN.md
```

## Key concepts

- **Three view modes** (`App.jsx`): `grid` (thumbnail browser), `viewer` (single video + tools), `theater` (online course player). Persisted in `localStorage`.
- **`local-video://` protocol** — privileged scheme registered in `main.cjs`, served via `protocol.handle` with HTTP 206 range support for smooth seeking. Renderer builds `local-video:///<path>` from `currentVideo`.
- **ffmpeg pipeline** — Despite README mentioning WebCodecs, actual processing spawns `ffmpeg-static`: crop, screenshots, GIF, compress, extract-audio, speed, concat, download. Each IPC handler streams progress back via `*-progress` events.
- **IPC surface** — All native ops go through `window.electronAPI` (defined in `preload.cjs`) ↔ `ipcMain.handle` in `main.cjs`. fs/path helpers are exposed directly in preload.
- **Theater mode** — Adds online course URLs (YouTube via `YouTubePlayer`, others via `CourseWebview` embedded webview). Tracks playback progress (saved every 3s), folders, thumbnails, persistent per-platform sessions. Data persisted to disk via `load/save-theater-data`.
- **.revid files** — JSON export/import format for courses/collections; validated by `utils/revidFile.js`; supports OS file-association open (`onOpenRevidFile`).
- **Mini player** — Separate frameless always-on-top `BrowserWindow`, time-synced via IPC.
- **i18n + theme** — `i18n.jsx` (en / zh-TW) and `theme.jsx` (dark/light) React context providers; `t()` for all strings.

## Commands

```bash
npm install
npm run electron:dev   # concurrently: vite dev (3001) + wait-on + electron
npm run dev            # vite only (browser, no electron APIs)
npm run build          # vite build → dist/
npm run preview        # preview built dist/
```

There is no test, lint, or typecheck script.

## Coding rules
- Inline-style heavy; theme values come from `useTheme()` (`theme.bg`, `theme.accent`, …) rather than CSS classes.
- All user-facing strings via `t()` from `useI18n()` — add keys for both `en` and `zh-TW`.
- Native/filesystem/ffmpeg work belongs in `main.cjs` behind an `ipcMain.handle`, exposed through `preload.cjs`; never import node `fs`/`child_process` in renderer code.
- IPC handlers return `{ success, ... }` / `{ success: false, error }` result objects.
