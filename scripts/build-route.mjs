import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const pedazos = path.resolve(root, '..', '..', 'pedazos');
const outPath = path.join(root, 'public', 'route.json');

const VIDEO_CLIP = 'VID_20251121_030905_00_005';

function haversineMeters(a, b) {
  const R = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingDegrees(a, b) {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function parseGpx(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8');
  const points = [];
  const re =
    /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)">([\s\S]*?)<\/trkpt>/g;
  let m;
  while ((m = re.exec(xml))) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    const body = m[3];
    const timeMatch = body.match(/<time>([^<]+)<\/time>/);
    const eleMatch = body.match(/<ele>([^<]+)<\/ele>/);
    if (!timeMatch) continue;
    points.push({
      lat,
      lon,
      ele: eleMatch ? Number(eleMatch[1]) : null,
      time: timeMatch[1],
      tMs: Date.parse(timeMatch[1]),
    });
  }
  return points;
}

/** Keep one sample per whole second (last reading of that second). */
function downsample1Hz(points) {
  const bySecond = new Map();
  for (const p of points) {
    const key = Math.floor(p.tMs / 1000);
    bySecond.set(key, p);
  }
  return [...bySecond.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, p]) => p);
}

function enrich(points) {
  const t0 = points[0].tMs;
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const from = i === 0 ? p : prev;
    const to = i === points.length - 1 ? p : next;
    let bearing = 0;
    let speed = 0;
    if (from !== to) {
      bearing = bearingDegrees(from, to);
      const dt = Math.max(0.001, (to.tMs - from.tMs) / 1000);
      speed = haversineMeters(from, to) / dt;
    } else if (i > 0) {
      bearing = out[i - 1].bearing;
      speed = out[i - 1].speed;
    }
    out.push({
      t: (p.tMs - t0) / 1000,
      lat: p.lat,
      lon: p.lon,
      ele: p.ele,
      bearing: Math.round(bearing * 10) / 10,
      speed: Math.round(speed * 10) / 10,
      time: p.time,
    });
  }
  return out;
}

function segmentIdFromName(name) {
  return path.basename(name, '.gpx');
}

if (!fs.existsSync(pedazos)) {
  console.error(`GPX folder not found: ${pedazos}`);
  process.exit(1);
}

const gpxFiles = fs
  .readdirSync(pedazos)
  .filter((f) => f.toLowerCase().endsWith('.gpx'))
  .sort();

if (gpxFiles.length === 0) {
  console.error(`No GPX files in ${pedazos}`);
  process.exit(1);
}

const segments = [];
for (const file of gpxFiles) {
  const full = path.join(pedazos, file);
  const raw = parseGpx(full);
  if (raw.length < 2) {
    console.warn(`Skipping ${file}: too few points`);
    continue;
  }
  const sampled = downsample1Hz(raw);
  const points = enrich(sampled);
  const id = segmentIdFromName(file);
  const dist = points.reduce((acc, p, i) => {
    if (i === 0) return 0;
    return acc + haversineMeters(points[i - 1], p);
  }, 0);

  segments.push({
    id,
    file,
    hasVideo: id === VIDEO_CLIP,
    video: id === VIDEO_CLIP ? 'media/005-proxy.mp4' : null,
    pointCount: points.length,
    durationSec: points[points.length - 1].t,
    distanceM: Math.round(dist),
    startTime: points[0].time,
    endTime: points[points.length - 1].time,
    bounds: {
      minLat: Math.min(...points.map((p) => p.lat)),
      maxLat: Math.max(...points.map((p) => p.lat)),
      minLon: Math.min(...points.map((p) => p.lon)),
      maxLon: Math.max(...points.map((p) => p.lon)),
    },
    points,
  });
  console.log(
    `${id}: ${points.length} pts, ${Math.round(dist)} m, ${points[points.length - 1].t.toFixed(0)} s${
      id === VIDEO_CLIP ? ' [video]' : ''
    }`,
  );
}

const active = segments.find((s) => s.hasVideo) ?? segments[0];

const payload = {
  generatedAt: new Date().toISOString(),
  sourceDir: pedazos,
  activeSegmentId: active.id,
  headingOffsetDefault: 180,
  segments,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload));
console.log(`Wrote ${outPath} (${segments.length} segments)`);
