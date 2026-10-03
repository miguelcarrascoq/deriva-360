import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const pedazos = path.resolve(root, '..', '..', 'pedazos');
const src = path.join(pedazos, 'VID_20251121_030905_00_005.mp4');
const outDir = path.join(root, 'public', 'media');
const out = path.join(outDir, '005-proxy.mp4');

// Keep under GitHub's 100 MB file limit for Pages / git hosting.
const force = process.argv.includes('--force');
const hq = process.argv.includes('--hq');
const scale = hq ? '2048:1024' : '1280:640';
const crf = hq ? '23' : '28';
const maxBytes = hq ? Infinity : 90 * 1024 * 1024;

if (!fs.existsSync(src)) {
  console.error(`Source video not found: ${src}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

if (!force && fs.existsSync(out)) {
  const st = fs.statSync(out);
  if (st.size > 1_000_000 && st.size <= maxBytes) {
    console.log(`Proxy already exists (${(st.size / 1e6).toFixed(1)} MB): ${out}`);
    process.exit(0);
  }
}

console.log(`Transcoding (${hq ? 'hq' : 'web'})\n  ${src}\n→ ${out}`);

const args = [
  '-y',
  '-i',
  src,
  '-vf',
  `scale=${scale}`,
  '-c:v',
  'libx264',
  '-preset',
  'fast',
  '-crf',
  crf,
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  '-c:a',
  'aac',
  '-b:a',
  hq ? '128k' : '96k',
  out,
];

const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const st = fs.statSync(out);
console.log(`Done: ${(st.size / 1e6).toFixed(1)} MB`);
if (!hq && st.size > maxBytes) {
  console.error(`Proxy is still too large for GitHub (${(st.size / 1e6).toFixed(1)} MB). Re-run with a higher CRF.`);
  process.exit(1);
}
