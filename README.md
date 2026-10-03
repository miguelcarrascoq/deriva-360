# Deriva 360 — MVP

Feasibility viewer for geo-located equirectangular (360°) video synced to GPX tracks from Insta360.

## Live demo

**GitHub Pages:** [https://miguelcarrascoq.github.io/deriva-360/](https://miguelcarrascoq.github.io/deriva-360/)

## What it demonstrates

- Look around inside a 360° video (drag) with play / seek
- Map marker follows `video.currentTime` on the GPX track (1 s video ≈ 1 s GPS)
- All 12 route segments on the map; only clip `VID_20251121_030905_00_005` has video
- Heading offset knob to align the video’s “forward” with travel direction (default **+180°**)

## Setup

Prerequisites: Node.js 20+, ffmpeg on `PATH`, and (for regenerating data) the sibling folder `../../pedazos` with the original MP4/GPX files.

```bash
npm install
npm run prepare-data   # optional if public/route.json + proxy already exist
npm run dev
```

Open http://localhost:5173/

### Scripts

| Command | Description |
| --- | --- |
| `npm run route` | Parse `../../pedazos/*.gpx` → `public/route.json` (1 Hz, bearing, speed) |
| `npm run proxy` | Transcode clip 005 to a web-sized H.264 proxy in `public/media/` |
| `npm run proxy -- --hq` | Higher-quality local proxy (may exceed GitHub size limits) |
| `npm run prepare-data` | `route` + `proxy` |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |

## Deploy

Pushes to `master` build and publish via GitHub Actions → GitHub Pages (`/deriva-360/`).

Manual: **Actions → Deploy to GitHub Pages → Run workflow**.

## Notes

- Original 6K HEVC files are not in the repo. The committed `public/media/005-proxy.mp4` is a compressed web proxy for Pages.
- Heading offset is persisted in `localStorage` (`deriva360.headingOffset`).
- Map opens zoomed on the playable segment (005). Other GPX segments remain visible at lower emphasis.
- Basemap switcher: **Streets** (OpenFreeMap), **Satellite** / **Hybrid** (Esri imagery). Default is Hybrid.
