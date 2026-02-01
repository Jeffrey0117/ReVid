# ReVid

Local-first video viewer and spatial crop tool for desktop.

> Sibling project of [RePic](https://github.com/Jeffrey0117/RePic) — RePic handles images, ReVid handles videos.

## Features

- **Playback** — [Plyr](https://plyr.io/)-powered MP4 player with zoom and pan
- **Spatial Crop** — Select any region on the video frame and export a cropped MP4
- **WebCodecs Pipeline** — Browser-native decode → canvas crop → re-encode, no ffmpeg required
- **Audio Passthrough** — Audio track is preserved without re-encoding
- **Custom Protocol** — `local-video://` scheme with HTTP 206 range request support for smooth seeking

## Tech Stack

| Layer | Tech |
|-------|------|
| Shell | Electron 31 |
| UI | React 19 + Vite |
| Player | Plyr |
| Demux | mp4box.js |
| Encode | WebCodecs (VideoEncoder / VideoDecoder) |
| Mux | mp4-muxer |

## Getting Started

```bash
npm install
npm run electron:dev
```

## Status

**0.1.0-poc** — Proof of concept. Playback and basic spatial crop are functional.

## License

MIT
