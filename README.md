# ReVid

A desktop video player for learning a language from the things you already
watch. Point it at a folder of episodes and it transcribes them, puts the
subtitles under your cursor, and remembers which words you already know.

> Sibling project of [RePic](https://github.com/Jeffrey0117/RePic) — RePic handles images, ReVid handles videos.

## Download

[**Latest release**](https://github.com/Jeffrey0117/ReVid/releases/latest) —
Windows installer. The Windows build updates itself from then on.

macOS builds from source in one command, with two caveats worth reading
first: [docs/MACOS.md](docs/MACOS.md).

## What it does

**Subtitles, from nothing.** Open a video with no subtitle file and ReVid
transcribes it with [whisper.cpp](https://github.com/ggml-org/whisper.cpp) —
on the GPU where CUDA is available. Cues appear in the player while the rest of
the file is still being transcribed. The whole folder is worked through in the
background, so the next episode is ready before you get to it.

**Subtitles you can put where you want them.** Drag the overlay anywhere, pull
a corner to scale the whole thing, pull a side to widen the background without
growing the text, double-click to put it back. Each folder remembers its own
placement. Over-long cues — transcription routinely emits six sentences as one
block — are split into two lines at a time and advance with the speech.

**Word lookup and a vocabulary list.** Click a word for a definition, mark the
ones you already know so they stop being highlighted, and keep the rest in a
list. Learning mode flags words above the level you've set; shadowing mode
pauses after each line so you can repeat it.

**Chapters.** Reads `.chapters.json` / `.chapters.vtt` sidecars into the
library, draws a strip of chapter blocks above the video, tints the real
progress bar with their colours, and shows the current chapter plus a countdown
to the next one.

**Watch on your phone or another computer.** Share the open folder and ReVid
serves a player page on the local network — subtitles included, the whole show
rather than one season, nothing to install on the other device.

**Plays from a URL.** Paste an `.mp4`, `.webm` or `.m3u8` address to play it
directly or download it (HLS streams are muxed into a single MP4).

**Editing when you need it.** Spatial crop, trim, screenshots, GIF export,
compression, audio extraction, speed changes, batch crop and rename, and
concatenation — all through ffmpeg.

**Auto-play-next**, off by default: a five-second countdown at the end of an
episode that any keypress cancels.

Also: a floating always-on-top mini player, Chinese translation of cues, a
theater mode for online course videos, and dark/light themes in English and
Traditional Chinese.

## In the browser

The subtitle overlay is published as
[subtitle-overlay-kit](https://github.com/Jeffrey0117/subtitle-overlay-kit) and
reused by [revid-web](https://github.com/Jeffrey0117/revid-web) — a userscript
and a browser extension that put the same subtitle behaviour on video in a web
page. One implementation behind all four shells, so they cannot drift apart.

## Tech Stack

| Layer | Tech |
|-------|------|
| Shell | Electron 31 |
| UI | React 19 + Vite 6 + Tailwind CSS v4 |
| Player | Plyr |
| Video processing | ffmpeg (via `ffmpeg-static`) |
| Speech to text | whisper.cpp (CUDA or CPU) |
| Library format | `.revid` — one JSON file per folder |
| Updates | electron-updater + GitHub Releases |

Subtitles, chapters, placement and progress live in a `.revid` file inside the
folder they belong to, so they travel with the videos over a copy or a network
share and nothing is hidden in an app database.

## Developing

```bash
npm install
npm run electron:dev   # vite dev server + electron
npm test               # node:test, no framework
npm run electron:build # Windows installer into release/
npm run dist:mac       # macOS .dmg — must run on macOS
```

Plain `.jsx` and `.cjs`, no TypeScript. Architecture notes for contributors (and
for Claude) are in [CLAUDE.md](CLAUDE.md).

## License

MIT
