import * as THREE from 'three';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

/** Asset URL under Vite `base` (needed for GitHub Pages `/deriva-360/`). */
function assetUrl(path) {
  const base = import.meta.env.BASE_URL || '/';
  const clean = String(path || '').replace(/^\/+/, '');
  return `${base}${clean}`;
}

const statusEl = document.getElementById('status');
const telTime = document.getElementById('tel-time');
const telSpeed = document.getElementById('tel-speed');
const telEle = document.getElementById('tel-ele');
const telBearing = document.getElementById('tel-bearing');
const telPitch = document.getElementById('tel-pitch');
const telZoom = document.getElementById('tel-zoom');
const btnPlay = document.getElementById('btn-play');
const seek = document.getElementById('seek');
const clock = document.getElementById('clock');
const alignHeading = document.getElementById('align-heading');
const headingOffset = document.getElementById('heading-offset');
const headingOffsetNum = document.getElementById('heading-offset-num');
const orientPad = document.getElementById('orient-pad');
const orientRing = document.getElementById('orient-ring');
const orientHorizon = document.getElementById('orient-horizon');
const orientYawVal = document.getElementById('orient-yaw-val');
const orientPitchVal = document.getElementById('orient-pitch-val');
const pitchNum = document.getElementById('pitch-num');
const pitchRange = document.getElementById('pitch-range');
const pitchReset = document.getElementById('pitch-reset');
const fovNum = document.getElementById('fov-num');
const zoomRange = document.getElementById('zoom-range');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomReset = document.getElementById('zoom-reset');
const video = document.getElementById('video');
const canvas = document.getElementById('sphere');
const videoLoading = document.getElementById('video-loading');

const OFFSET_STORAGE_KEY = 'deriva360.headingOffset';
const PITCH_STORAGE_KEY = 'deriva360.pitch';
const FOV_STORAGE_KEY = 'deriva360.fov';
const PITCH_MIN = -85;
const PITCH_MAX = 85;
const FOV_MIN = 40;
const FOV_MAX = 150;
const FOV_DEFAULT = 100;
const ZOOM_STEP = 5;

function clampOffset(value) {
  let n = Number(value);
  if (!Number.isFinite(n)) n = 0;
  // Keep in (-180, 180]
  n = ((((n + 180) % 360) + 360) % 360) - 180;
  if (n === -180) n = 180;
  return Math.round(n);
}

function clampPitch(value) {
  let n = Number(value);
  if (!Number.isFinite(n)) n = 0;
  return Math.max(PITCH_MIN, Math.min(PITCH_MAX, Math.round(n)));
}

function getHeadingOffset() {
  return clampOffset(headingOffset.value);
}

function getPitch() {
  return clampPitch(lat);
}

function formatSignedDeg(n) {
  return `${n > 0 ? '+' : ''}${n}°`;
}

function updateOrientPad() {
  const yaw = getHeadingOffset();
  const pitch = getPitch();
  orientRing.style.transform = `rotate(${yaw}deg)`;
  // Pitch shifts the horizon: +pitch (look up) moves horizon down in view → marker up.
  const t = pitch / PITCH_MAX; // -1..1
  const topPct = 50 - t * 34;
  orientHorizon.style.top = `${topPct}%`;
  orientYawVal.textContent = formatSignedDeg(yaw);
  orientPitchVal.textContent = formatSignedDeg(pitch);
  if (telPitch) telPitch.textContent = `pitch ${formatSignedDeg(pitch)}`;
}

function formatTime(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function sampleAt(points, t) {
  if (!points.length) return null;
  if (t <= points[0].t) return points[0];
  if (t >= points[points.length - 1].t) return points[points.length - 1];
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b.t - a.t || 1;
  const u = (t - a.t) / span;
  return {
    t,
    lat: a.lat + (b.lat - a.lat) * u,
    lon: a.lon + (b.lon - a.lon) * u,
    ele: a.ele + ((b.ele ?? a.ele) - (a.ele ?? 0)) * u,
    bearing: a.bearing + shortestAngleDelta(a.bearing, b.bearing) * u,
    speed: a.speed + (b.speed - a.speed) * u,
    time: a.time,
  };
}

function shortestAngleDelta(from, to) {
  let d = ((to - from + 540) % 360) - 180;
  return d;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function showVideoLoading(title, msg) {
  if (!videoLoading) return;
  const titleEl = videoLoading.querySelector('.video-loading-title');
  const msgEl = videoLoading.querySelector('.video-loading-msg');
  const spinner = videoLoading.querySelector('.video-loading-spinner');
  if (titleEl && title) titleEl.textContent = title;
  if (msgEl && msg) msgEl.textContent = msg;
  spinner?.classList.remove('is-stopped');
  videoLoading.hidden = false;
  videoLoading.classList.remove('is-hiding');
  videoLoading.setAttribute('aria-busy', 'true');
}

function hideVideoLoading() {
  if (!videoLoading || videoLoading.hidden) return;
  videoLoading.setAttribute('aria-busy', 'false');
  videoLoading.classList.add('is-hiding');
  const done = () => {
    videoLoading.hidden = true;
    videoLoading.classList.remove('is-hiding');
    videoLoading.removeEventListener('transitionend', done);
  };
  videoLoading.addEventListener('transitionend', done);
  // Fallback if transitionend doesn't fire (e.g. reduced motion / display none)
  window.setTimeout(done, 400);
}

function setPlayEnabled(enabled) {
  btnPlay.disabled = !enabled;
  btnPlay.title = enabled ? '' : 'Esperá a que cargue el video';
}

function getBufferedRatio(el) {
  const dur = el.duration;
  if (!Number.isFinite(dur) || dur <= 0 || el.buffered.length === 0) return 0;
  // Continuous coverage from the start (handles sparse TimeRanges).
  let covered = 0;
  for (let i = 0; i < el.buffered.length; i += 1) {
    const start = el.buffered.start(i);
    const end = el.buffered.end(i);
    if (start <= covered + 0.35) covered = Math.max(covered, end);
  }
  return Math.min(1, covered / dur);
}

/** Enough data to start playback (browsers often never buffer 100% of large files). */
function isVideoPlayable(el) {
  return el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
}

function updateVideoLoadProgress(el) {
  const pct = Math.round(getBufferedRatio(el) * 100);
  setStatus(`Loading video… ${pct}%`);
  showVideoLoading('Cargando video 360°', `Descargando… ${pct}%`);
}

function waitForVideoReady(el) {
  updateVideoLoadProgress(el);
  if (isVideoPlayable(el)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const onProgress = () => {
      updateVideoLoadProgress(el);
      if (isVideoPlayable(el)) {
        cleanup();
        resolve();
      }
    };
    const onReady = () => {
      updateVideoLoadProgress(el);
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('Could not load proxy. Run npm run proxy'));
    };
    const cleanup = () => {
      el.removeEventListener('progress', onProgress);
      el.removeEventListener('canplay', onReady);
      el.removeEventListener('canplaythrough', onReady);
      el.removeEventListener('loadeddata', onProgress);
      el.removeEventListener('error', onErr);
    };
    el.addEventListener('progress', onProgress);
    el.addEventListener('canplay', onReady);
    el.addEventListener('canplaythrough', onReady);
    el.addEventListener('loadeddata', onProgress);
    el.addEventListener('error', onErr);
    // Events may have already fired before listeners were attached.
    onProgress();
  });
}

/** --- Three.js sphere viewer --- */
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(100, 1, 0.1, 1000);
camera.position.set(0, 0, 0.01);

const sphereGeom = new THREE.SphereGeometry(500, 64, 40);
sphereGeom.scale(-1, 1, 1);
const sphereMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
const sphere = new THREE.Mesh(sphereGeom, sphereMat);
scene.add(sphere);

let lon = 0; // degrees, yaw look
let lat = 0; // degrees, pitch look
let isDragging = false;
let prevX = 0;
let prevY = 0;
let seeking = false;

function resizeViewer() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function applyLook() {
  lat = clampPitch(lat);
  // Offset calibrates video "forward" vs GPS; always applied so the pad
  // rotates the world immediately without needing align-heading.
  const yaw = lon + getHeadingOffset();
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(yaw);
  const target = new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  );
  camera.lookAt(target);
}

function setHeadingOffset(value, { persist = true, sync = true } = {}) {
  const n = clampOffset(value);
  headingOffset.value = String(n);
  headingOffsetNum.value = String(n);
  if (persist) {
    try {
      localStorage.setItem(OFFSET_STORAGE_KEY, String(n));
    } catch {
      /* ignore quota / private mode */
    }
  }
  updateOrientPad();
  if (sync) syncUiFromVideo();
}

function setPitch(value, { persist = true } = {}) {
  lat = clampPitch(value);
  pitchNum.value = String(lat);
  pitchRange.value = String(lat);
  if (persist) {
    try {
      localStorage.setItem(PITCH_STORAGE_KEY, String(lat));
    } catch {
      /* ignore */
    }
  }
  updateOrientPad();
}

function clampFov(value) {
  let n = Number(value);
  if (!Number.isFinite(n)) n = FOV_DEFAULT;
  return Math.max(FOV_MIN, Math.min(FOV_MAX, Math.round(n)));
}

/** Zoom UI level: 0 = widest (FOV_MAX), FOV_MAX-FOV_MIN = tightest (FOV_MIN). */
function zoomLevelFromFov(fov) {
  return FOV_MAX - clampFov(fov);
}

function fovFromZoomLevel(level) {
  return clampFov(FOV_MAX - Number(level));
}

function getFov() {
  return clampFov(camera.fov);
}

function setFov(value, { persist = true } = {}) {
  const fov = clampFov(value);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  fovNum.value = String(fov);
  zoomRange.value = String(zoomLevelFromFov(fov));
  if (telZoom) telZoom.textContent = `zoom ${fov}°`;
  if (persist) {
    try {
      localStorage.setItem(FOV_STORAGE_KEY, String(fov));
    } catch {
      /* ignore */
    }
  }
}

let padDragging = false;
let padPrevX = 0;
let padPrevY = 0;

orientPad.addEventListener('pointerdown', (e) => {
  padDragging = true;
  orientPad.classList.add('dragging');
  orientPad.setPointerCapture(e.pointerId);
  padPrevX = e.clientX;
  padPrevY = e.clientY;
});

orientPad.addEventListener('pointermove', (e) => {
  if (!padDragging) return;
  const dx = e.clientX - padPrevX;
  const dy = e.clientY - padPrevY;
  padPrevX = e.clientX;
  padPrevY = e.clientY;
  // Pad always edits calibration (yaw offset + pitch), even with Align on.
  setHeadingOffset(getHeadingOffset() - dx * 0.35, { persist: false, sync: false });
  setPitch(getPitch() - dy * 0.25, { persist: false });
});

function endPadDrag(e) {
  if (!padDragging) return;
  padDragging = false;
  orientPad.classList.remove('dragging');
  try {
    orientPad.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  setHeadingOffset(getHeadingOffset(), { persist: true, sync: false });
  setPitch(getPitch(), { persist: true });
}

orientPad.addEventListener('pointerup', endPadDrag);
orientPad.addEventListener('pointercancel', endPadDrag);

orientPad.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 10 : 1;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    setHeadingOffset(getHeadingOffset() - step);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    setHeadingOffset(getHeadingOffset() + step);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setPitch(getPitch() + step);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    setPitch(getPitch() - step);
  } else if (e.key === 'Home') {
    e.preventDefault();
    setHeadingOffset(0);
    setPitch(0);
  }
});

headingOffset.addEventListener('input', () => {
  setHeadingOffset(headingOffset.value);
});

headingOffsetNum.addEventListener('change', () => {
  setHeadingOffset(headingOffsetNum.value);
});

headingOffsetNum.addEventListener('input', () => {
  const n = Number(headingOffsetNum.value);
  if (Number.isFinite(n)) setHeadingOffset(n, { persist: false });
});

pitchRange.addEventListener('input', () => {
  setPitch(pitchRange.value, { persist: false });
});

pitchRange.addEventListener('change', () => {
  setPitch(pitchRange.value, { persist: true });
});

pitchNum.addEventListener('change', () => {
  setPitch(pitchNum.value);
});

pitchNum.addEventListener('input', () => {
  const n = Number(pitchNum.value);
  if (Number.isFinite(n)) setPitch(n, { persist: false });
});

pitchReset.addEventListener('click', () => {
  setPitch(0);
});

zoomRange.addEventListener('input', () => {
  setFov(fovFromZoomLevel(zoomRange.value), { persist: false });
});

zoomRange.addEventListener('change', () => {
  setFov(fovFromZoomLevel(zoomRange.value), { persist: true });
});

fovNum.addEventListener('change', () => {
  setFov(fovNum.value);
});

fovNum.addEventListener('input', () => {
  const n = Number(fovNum.value);
  if (Number.isFinite(n)) setFov(n, { persist: false });
});

zoomInBtn.addEventListener('click', () => {
  setFov(getFov() - ZOOM_STEP);
});

zoomOutBtn.addEventListener('click', () => {
  setFov(getFov() + ZOOM_STEP);
});

zoomReset.addEventListener('click', () => {
  setFov(FOV_DEFAULT);
});

canvas.addEventListener('pointerdown', (e) => {
  isDragging = true;
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
  prevX = e.clientX;
  prevY = e.clientY;
});

canvas.addEventListener('pointermove', (e) => {
  if (!isDragging) return;
  const dx = e.clientX - prevX;
  const dy = e.clientY - prevY;
  prevX = e.clientX;
  prevY = e.clientY;
  if (alignHeading.checked) {
    // Temporary look relative to GPS heading — do not corrupt calibration yaw.
    lon -= dx * 0.15;
  } else {
    setHeadingOffset(getHeadingOffset() - dx * 0.15, { persist: false, sync: false });
  }
  // Vertical drag updates pitch (same sign as before: drag down → look up).
  setPitch(getPitch() + dy * 0.15, { persist: false });
});

function endDrag(e) {
  if (!isDragging) return;
  isDragging = false;
  canvas.classList.remove('dragging');
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  if (!alignHeading.checked) {
    setHeadingOffset(getHeadingOffset(), { persist: true, sync: false });
  }
  setPitch(getPitch(), { persist: true });
}

alignHeading.addEventListener('change', () => {
  if (alignHeading.checked) {
    // Snap look to current GPS bearing; offset stays as video calibration.
    if (active) {
      const sample = sampleAt(active.points, video.currentTime || 0);
      if (sample) lon = -sample.bearing;
    }
  } else {
    // Restore calibration-only view. Leaving lon at -bearing was shifting
    // the image while the degrees UI still showed the old offset.
    lon = 0;
  }
});

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

let fovPersistTimer = 0;
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    setFov(getFov() + e.deltaY * 0.05, { persist: false });
    window.clearTimeout(fovPersistTimer);
    fovPersistTimer = window.setTimeout(() => {
      setFov(getFov(), { persist: true });
    }, 200);
  },
  { passive: false },
);

window.addEventListener('resize', resizeViewer);
resizeViewer();

/** --- Map --- */
const ESRI_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABELS =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const ESRI_ROADS =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';

const BASEMAPS = {
  streets: 'https://tiles.openfreemap.org/styles/liberty',
  satellite: {
    version: 8,
    name: 'Satellite',
    sources: {
      esriImagery: {
        type: 'raster',
        tiles: [ESRI_IMAGERY],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© Esri',
      },
    },
    layers: [
      {
        id: 'esri-imagery',
        type: 'raster',
        source: 'esriImagery',
      },
    ],
  },
  hybrid: {
    version: 8,
    name: 'Hybrid',
    sources: {
      esriImagery: {
        type: 'raster',
        tiles: [ESRI_IMAGERY],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© Esri',
      },
      esriRoads: {
        type: 'raster',
        tiles: [ESRI_ROADS],
        tileSize: 256,
        maxzoom: 19,
        attribution: '',
      },
      esriLabels: {
        type: 'raster',
        tiles: [ESRI_LABELS],
        tileSize: 256,
        maxzoom: 19,
        attribution: '',
      },
    },
    layers: [
      {
        id: 'esri-imagery',
        type: 'raster',
        source: 'esriImagery',
      },
      {
        id: 'esri-roads',
        type: 'raster',
        source: 'esriRoads',
      },
      {
        id: 'esri-labels',
        type: 'raster',
        source: 'esriLabels',
      },
    ],
  },
};

const BASEMAP_STORAGE_KEY = 'deriva360.basemap';
let currentBasemap = 'hybrid';
try {
  const savedBasemap = localStorage.getItem(BASEMAP_STORAGE_KEY);
  if (savedBasemap && BASEMAPS[savedBasemap]) currentBasemap = savedBasemap;
} catch {
  /* ignore */
}

const map = new maplibregl.Map({
  container: 'map',
  style: BASEMAPS[currentBasemap],
  center: [-71.808, -38.7],
  zoom: 13,
  attributionControl: false,
});
map.addControl(
  new maplibregl.AttributionControl({
    compact: true,
    customAttribution: 'MapLibre',
  }),
  'bottom-right',
);
map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

function resizeMap() {
  map.resize();
}

const layoutResizeObserver =
  typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => {
        resizeViewer();
        resizeMap();
      })
    : null;
if (layoutResizeObserver) {
  layoutResizeObserver.observe(canvas.parentElement);
  layoutResizeObserver.observe(document.getElementById('map-panel'));
  layoutResizeObserver.observe(document.getElementById('sidebar'));
}

const basemapSwitcher = document.querySelector('.basemap-switcher');
const basemapToggle = document.getElementById('basemap-toggle');
const basemapMenu = document.getElementById('basemap-menu');
const basemapButtons = document.querySelectorAll('.basemap-btn[data-basemap]');

function syncBasemapButtons() {
  for (const btn of basemapButtons) {
    const activeBtn = btn.dataset.basemap === currentBasemap;
    btn.classList.toggle('active', activeBtn);
    btn.setAttribute('aria-checked', activeBtn ? 'true' : 'false');
  }
}

function setBasemapMenuOpen(open) {
  basemapSwitcher.classList.toggle('open', open);
  basemapToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  basemapMenu.hidden = !open;
}

function setBasemap(name) {
  if (!BASEMAPS[name]) {
    syncBasemapButtons();
    setBasemapMenuOpen(false);
    return;
  }
  const changed = name !== currentBasemap;
  currentBasemap = name;
  syncBasemapButtons();
  try {
    localStorage.setItem(BASEMAP_STORAGE_KEY, name);
  } catch {
    /* ignore */
  }
  setBasemapMenuOpen(false);
  if (changed) map.setStyle(BASEMAPS[name]);
}

basemapToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  setBasemapMenuOpen(basemapMenu.hidden);
});

for (const btn of basemapButtons) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setBasemap(btn.dataset.basemap);
  });
}

document.addEventListener('click', (e) => {
  if (!basemapSwitcher.contains(e.target)) setBasemapMenuOpen(false);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setBasemapMenuOpen(false);
});

syncBasemapButtons();
setBasemapMenuOpen(false);

const markerEl = document.createElement('div');
markerEl.style.width = '14px';
markerEl.style.height = '14px';
markerEl.style.borderRadius = '50%';
markerEl.style.background = '#ff4d4f';
markerEl.style.border = '2px solid #fff';
markerEl.style.boxShadow = '0 0 0 2px rgba(0,0,0,0.35)';
const marker = new maplibregl.Marker({ element: markerEl, rotationAlignment: 'map' });

const arrowEl = document.createElement('div');
arrowEl.style.width = '0';
arrowEl.style.height = '0';
arrowEl.style.borderLeft = '7px solid transparent';
arrowEl.style.borderRight = '7px solid transparent';
arrowEl.style.borderBottom = '16px solid #3fb950';
arrowEl.style.filter = 'drop-shadow(0 1px 1px rgba(0,0,0,0.5))';
const arrow = new maplibregl.Marker({
  element: arrowEl,
  rotationAlignment: 'map',
  pitchAlignment: 'map',
});

let routeData = null;
let active = null;
let mapInteractionsBound = false;
let didFitActiveBounds = false;

function boundsOfAll(segments) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const s of segments) {
    minLat = Math.min(minLat, s.bounds.minLat);
    maxLat = Math.max(maxLat, s.bounds.maxLat);
    minLon = Math.min(minLon, s.bounds.minLon);
    maxLon = Math.max(maxLon, s.bounds.maxLon);
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

function bindMapInteractions() {
  if (mapInteractionsBound) return;
  mapInteractionsBound = true;

  map.on('click', 'tracks-active', (e) => {
    if (!active || !e.features?.length) return;
    const { lng, lat: clickLat } = e.lngLat;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < active.points.length; i++) {
      const p = active.points[i];
      const d = (p.lon - lng) ** 2 + (p.lat - clickLat) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const t = active.points[best].t;
    seeking = true;
    video.currentTime = Math.min(t, video.duration || t);
    seek.value = String(Math.round((t / (active.durationSec || 1)) * 1000));
    seeking = false;
  });

  map.on('mouseenter', 'tracks-active', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'tracks-active', () => {
    map.getCanvas().style.cursor = '';
  });
}

function trackFeatures() {
  return routeData.segments.map((seg) => ({
    type: 'Feature',
    properties: {
      id: seg.id,
      // Numeric flag avoids boolean filter quirks across style reloads.
      hasVideo: seg.hasVideo ? 1 : 0,
      distanceM: seg.distanceM,
    },
    geometry: {
      type: 'LineString',
      coordinates: seg.points.map((p) => [p.lon, p.lat]),
    },
  }));
}

function addTrackLayers() {
  if (!map.getLayer('tracks-other')) {
    map.addLayer({
      id: 'tracks-other',
      type: 'line',
      source: 'tracks',
      filter: ['==', ['get', 'hasVideo'], 0],
      paint: {
        'line-color': '#4da3ff',
        'line-width': 3,
        'line-opacity': 0.7,
      },
    });
  }

  if (!map.getLayer('tracks-active-casing')) {
    map.addLayer({
      id: 'tracks-active-casing',
      type: 'line',
      source: 'tracks',
      filter: ['==', ['get', 'hasVideo'], 1],
      paint: {
        'line-color': '#04140a',
        'line-width': 8,
        'line-opacity': 0.85,
      },
    });
  }

  if (!map.getLayer('tracks-active')) {
    map.addLayer({
      id: 'tracks-active',
      type: 'line',
      source: 'tracks',
      filter: ['==', ['get', 'hasVideo'], 1],
      paint: {
        'line-color': '#3dff6a',
        'line-width': 5,
        'line-opacity': 1,
      },
    });
  }
}

function placeTrackMarkers() {
  const p0 = active.points[0];
  marker.setLngLat([p0.lon, p0.lat]).addTo(map);
  arrow.setLngLat([p0.lon, p0.lat]).addTo(map);
}

function addRoutesToMap({ fit = false } = {}) {
  if (!routeData || !active) return false;
  // Prefer getStyle() over isStyleLoaded(): the latter can stay false even when
  // the style is already usable, which previously skipped drawing the track.
  if (!map.getStyle()) return false;

  try {
    const features = trackFeatures();
    const source = map.getSource('tracks');
    if (source) {
      source.setData({ type: 'FeatureCollection', features });
    } else {
      map.addSource('tracks', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });
    }

    addTrackLayers();
    bindMapInteractions();
    placeTrackMarkers();

    if (fit || !didFitActiveBounds) {
      const focus = active.bounds
        ? [
            [active.bounds.minLon, active.bounds.minLat],
            [active.bounds.maxLon, active.bounds.maxLat],
          ]
        : boundsOfAll(routeData.segments);
      map.fitBounds(focus, { padding: 48, duration: 0, maxZoom: 16 });
      didFitActiveBounds = true;
    }
    return true;
  } catch (err) {
    console.error('Failed to add routes to map', err);
    return false;
  }
}

function ensureRoutesOnMap(opts = {}) {
  if (!routeData || !active) return;
  if (addRoutesToMap(opts)) return;

  const retry = () => {
    if (!addRoutesToMap(opts)) {
      // One more attempt on the next frame if style is mid-swap.
      requestAnimationFrame(() => addRoutesToMap(opts));
    }
  };
  map.once('style.load', retry);
  // Fallback if style.load already fired before this listener was attached.
  setTimeout(retry, 0);
  setTimeout(retry, 250);
}

map.on('style.load', () => {
  // Re-add track overlays after every basemap change / initial style ready.
  addRoutesToMap();
});

function updateTelemetry(sample) {
  if (!sample) return;
  telTime.textContent = `t ${formatTime(sample.t)}`;
  telSpeed.textContent = `${(sample.speed * 3.6).toFixed(1)} km/h`;
  telEle.textContent = `${(sample.ele ?? 0).toFixed(0)} m`;
  const offset = getHeadingOffset();
  const offLabel = formatSignedDeg(offset);
  telBearing.textContent = `heading ${sample.bearing.toFixed(0)}° · off ${offLabel}`;
  if (telPitch) telPitch.textContent = `pitch ${formatSignedDeg(getPitch())}`;
  marker.setLngLat([sample.lon, sample.lat]);
  arrow.setLngLat([sample.lon, sample.lat]);
  // Map arrow = true travel direction (GPS). Video offset is visual calibration only.
  arrow.setRotation(sample.bearing);
  updateOrientPad();

  if (alignHeading.checked && !isDragging) {
    // Keep facing travel direction. Offset (calibration) is applied in applyLook().
    lon = -sample.bearing;
  }
}

function syncUiFromVideo() {
  if (!active) return;
  const t = video.currentTime || 0;
  const dur = active.durationSec || video.duration || 1;
  if (!seeking) {
    seek.value = String(Math.round((t / dur) * 1000));
  }
  clock.textContent = `${formatTime(t)} / ${formatTime(dur)}`;
  const sample = sampleAt(active.points, t);
  updateTelemetry(sample);
}

btnPlay.addEventListener('click', async () => {
  if (btnPlay.disabled) return;
  if (video.paused) {
    try {
      await video.play();
      btnPlay.textContent = 'Pause';
      setStatus('Playing');
    } catch (err) {
      setStatus(`Playback blocked: ${err.message}`);
    }
  } else {
    video.pause();
    btnPlay.textContent = 'Play';
    setStatus('Paused');
  }
});

seek.addEventListener('input', () => {
  if (!active) return;
  seeking = true;
  const dur = active.durationSec || video.duration || 1;
  const t = (Number(seek.value) / 1000) * dur;
  video.currentTime = t;
  clock.textContent = `${formatTime(t)} / ${formatTime(dur)}`;
  updateTelemetry(sampleAt(active.points, t));
});

seek.addEventListener('change', () => {
  seeking = false;
});

video.addEventListener('play', () => {
  btnPlay.textContent = 'Pause';
});
video.addEventListener('pause', () => {
  btnPlay.textContent = 'Play';
});
video.addEventListener('ended', () => {
  btnPlay.textContent = 'Play';
  setStatus('End of clip');
});

function animate() {
  requestAnimationFrame(animate);
  syncUiFromVideo();
  applyLook();
  renderer.render(scene, camera);
}

async function boot() {
  setStatus('Loading route.json…');
  showVideoLoading(
    'Cargando recorrido…',
    'Preparando mapa y video 360°…',
  );
  const res = await fetch(assetUrl('route.json'));
  if (!res.ok) {
    setStatus('Missing route.json — run npm run route');
    showVideoLoading('Falta route.json', 'Ejecutá npm run route y recargá.');
    videoLoading?.querySelector('.video-loading-spinner')?.classList.add('is-stopped');
    return;
  }
  routeData = await res.json();
  active =
    routeData.segments.find((s) => s.id === routeData.activeSegmentId) ||
    routeData.segments.find((s) => s.hasVideo) ||
    routeData.segments[0];

  let initialOffset = routeData.headingOffsetDefault ?? 180;
  let initialPitch = routeData.pitchDefault ?? -13;
  let initialFov = FOV_DEFAULT;
  try {
    const saved = localStorage.getItem(OFFSET_STORAGE_KEY);
    if (saved != null && saved !== '') initialOffset = saved;
    const savedPitch = localStorage.getItem(PITCH_STORAGE_KEY);
    if (savedPitch != null && savedPitch !== '') initialPitch = savedPitch;
    const savedFov = localStorage.getItem(FOV_STORAGE_KEY);
    if (savedFov != null && savedFov !== '') initialFov = savedFov;
  } catch {
    /* ignore */
  }
  setHeadingOffset(initialOffset, { persist: false, sync: false });
  setPitch(initialPitch, { persist: false });
  setFov(initialFov, { persist: false });

  ensureRoutesOnMap({ fit: true });

  setPlayEnabled(false);

  if (!active?.video) {
    setStatus('Active segment has no video');
    hideVideoLoading();
    animate();
    return;
  }

  setStatus('Loading video proxy…');
  showVideoLoading(
    'Cargando video 360°',
    'El archivo es pesado; esto puede tardar unos segundos…',
  );
  video.src = assetUrl(active.video);
  video.load();

  await new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('Could not load proxy. Run npm run proxy'));
    };
    const cleanup = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onErr);
    };
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('error', onErr);
  }).catch((err) => {
    setStatus(err.message);
    showVideoLoading('No se pudo cargar el video', err.message);
    videoLoading?.querySelector('.video-loading-spinner')?.classList.add('is-stopped');
  });

  if (video.readyState >= 2) {
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    // RVFC may have already fired before the texture existed; force the
    // current decoded frame onto the GPU so the sphere isn't black while paused.
    tex.needsUpdate = true;
    sphereMat.map = tex;
    sphereMat.color.set(0xffffff);
    sphereMat.needsUpdate = true;
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => {
        tex.needsUpdate = true;
      });
    }
    updateTelemetry(sampleAt(active.points, 0));

    try {
      await waitForVideoReady(video);
      tex.needsUpdate = true;
      setPlayEnabled(true);
      setStatus(`Ready — ${active.id} (${active.distanceM} m)`);
      hideVideoLoading();
    } catch (err) {
      setPlayEnabled(false);
      setStatus(err.message);
      showVideoLoading('No se pudo cargar el video', err.message);
      videoLoading?.querySelector('.video-loading-spinner')?.classList.add('is-stopped');
    }
  }

  // Safety net: style may finish after route.json, or overlays may have been skipped.
  ensureRoutesOnMap({ fit: !didFitActiveBounds });

  animate();
}

boot().catch((err) => {
  console.error(err);
  setStatus(err.message || String(err));
  showVideoLoading('Error al iniciar', err.message || String(err));
  videoLoading?.querySelector('.video-loading-spinner')?.classList.add('is-stopped');
});
