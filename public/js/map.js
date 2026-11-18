// Leaflet map: city AQI pills, NASA FIRMS fire hotspots, citizen reports and a
// "pick a location" mode for reporting burning. Uses the global `L`.
// No DOM access happens at import time; everything starts in initMap().

import { t, getLang } from './i18n.js';
import { aqiCategory } from './aqi.js';

const LAHORE = [31.5204, 74.3587];
// Fallback view before city data arrives: Karachi to Peshawar to Lahore.
const CITY_BOX = [[24.8, 67.0], [34.1, 74.4]];

const TILES = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
};
const CARTO_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const TILE_ERROR_LIMIT = 6;

// Strings not (yet) in i18n.js: use t() when a key exists, else these fallbacks.
const LOCAL = {
  'map.layer.cities': { en: 'Cities (AQI)', ur: 'شہر (AQI)' },
  'map.layer.fires': { en: 'Fire hotspots', ur: 'آگ کے مقامات' },
  'map.layer.reports': { en: 'Citizen reports', ur: 'شہری رپورٹس' },
  'map.measured': { en: 'Measured', ur: 'پیمائش' },
  'map.source': { en: 'Source', ur: 'ماخذ' },
  'map.report.title': { en: 'Citizen report', ur: 'شہری رپورٹ' },
  'map.conf.l': { en: 'Low', ur: 'کم' },
  'map.conf.n': { en: 'Nominal', ur: 'درمیانہ' },
  'map.conf.h': { en: 'High', ur: 'زیادہ' },
};

const REPORT_ICONS = {
  crop_burning: '🌾',
  waste_burning: '🗑️',
  brick_kiln: '🧱',
  industrial: '🏭',
  other: '🔥',
};

let map = null;
let layers = null;
let layerControl = null;
let tileLayer = null;
let tileMode = null; // 'light' | 'dark' | 'osm-light' | 'osm-dark'
let tileErrors = 0;
let pickedMarker = null;
let reportMode = false;
let opts = { categoryOf: null, onPick: null };
let didFitCities = false; // fit all city markers once, until the user moves the map
let userMoved = false;
const data = { cities: null, fires: null, reports: [] };

/* ----------------------------------------------------------------- helpers */

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function lang() {
  try {
    const l = getLang();
    if (l === 'ur' || l === 'en') return l;
  } catch { /* i18n not ready */ }
  return document.documentElement.lang === 'ur' ? 'ur' : 'en';
}

function tr(key) {
  const s = t(key);
  if (s && s !== key) return s;
  const f = LOCAL[key];
  return f ? (f[lang()] || f.en) : key;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function categoryOf(aqi) {
  if (typeof opts.categoryOf === 'function') {
    const c = opts.categoryOf(aqi);
    if (c && c.color) return c;
  }
  return aqiCategory(aqi);
}

/** Popup DOM: title, optional badge, then [label, value] rows. All via textContent. */
function popupContent(title, rows, { badge = null, note = null, footer = null } = {}) {
  const box = el('div', 'ss-map-popup');
  box.dir = lang() === 'ur' ? 'rtl' : 'ltr';
  box.appendChild(el('div', 'ss-map-popup-title', title));
  if (badge) {
    const b = el('div', 'ss-map-badge');
    b.style.background = badge.color;
    b.style.color = badge.textColor;
    b.appendChild(el('strong', null, badge.value));
    b.appendChild(el('span', null, badge.label));
    box.appendChild(b);
  }
  if (note) box.appendChild(el('p', 'ss-map-note', note));
  const list = rows.filter(Boolean);
  if (list.length) {
    const dl = el('dl', 'ss-map-rows');
    list.forEach(([k, v]) => {
      dl.appendChild(el('dt', null, k));
      dl.appendChild(el('dd', null, v));
    });
    box.appendChild(dl);
  }
  if (footer) box.appendChild(el('div', 'ss-map-foot', footer));
  return box;
}

function locale() {
  return lang() === 'ur' ? 'ur-PK' : 'en-GB';
}

/** "2026-11-18T17:00" (already Pakistan local time) → "18 Nov, 17:00". */
function formatLocalStamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return s ? String(s) : '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return d.toLocaleString(locale(), {
    timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }) + ' PKT';
}

/** FIRMS date "2026-11-18" + time "0832" (UTC) → local Pakistan time string. */
function formatFireWhen(date, time) {
  if (!date) return '';
  const hhmm = String(time ?? '').padStart(4, '0');
  const iso = /^\d{4}$/.test(hhmm) ? `${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z` : `${date}T00:00:00Z`;
  const d = new Date(iso);
  if (isNaN(d)) return `${date} ${time ?? ''}`.trim();
  return d.toLocaleString(locale(), {
    timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }) + ' PKT';
}

function formatConfidence(c) {
  if (c == null || c === '') return null;
  const s = String(c).toLowerCase();
  if (s === 'l' || s === 'low') return tr('map.conf.l');
  if (s === 'n' || s === 'nominal') return tr('map.conf.n');
  if (s === 'h' || s === 'high') return tr('map.conf.h');
  return /^\d+(\.\d+)?$/.test(s) ? `${s}%` : String(c);
}

/* ------------------------------------------------------------------ styles */

const STYLE_ID = 'ss-map-style';
const CSS = `
.ss-map { font-family: var(--font, system-ui, sans-serif); background: var(--surface-2, #e9edf3); }
.ss-map .leaflet-popup-content-wrapper {
  background: var(--surface, #fff); color: var(--text, #111827);
  border: 1px solid var(--border, #e3e7ee); border-radius: var(--radius-sm, 10px);
  box-shadow: var(--shadow, 0 4px 16px rgba(16,24,40,.12));
}
.ss-map .leaflet-popup-tip { background: var(--surface, #fff); border: 1px solid var(--border, #e3e7ee); box-shadow: none; }
.ss-map .leaflet-popup-content { margin: 12px 14px; min-width: 170px; font-size: 13px; line-height: 1.45; }
.ss-map a.leaflet-popup-close-button { color: var(--muted, #5b6474); top: 4px; right: 4px; }
.ss-map a.leaflet-popup-close-button:hover { color: var(--text, #111827); }
.ss-map-popup-title { font-weight: 700; font-size: 15px; margin: 0 18px 6px 0; }
.ss-map-popup[dir="rtl"] .ss-map-popup-title { margin: 0 0 6px 18px; }
.ss-map-badge { display: inline-flex; align-items: baseline; gap: 6px; padding: 3px 9px; border-radius: 999px; margin-bottom: 8px; font-size: 12px; }
.ss-map-badge strong { font-size: 15px; font-variant-numeric: tabular-nums; }
.ss-map-rows { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0; }
.ss-map-rows dt { color: var(--muted, #5b6474); }
.ss-map-rows dd { margin: 0; font-variant-numeric: tabular-nums; }
.ss-map-note { margin: 0 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
.ss-map-foot { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--border, #e3e7ee); color: var(--muted, #5b6474); font-size: 11px; }

.ss-map-pin-wrap { background: none; border: 0; }
.ss-map-pill {
  display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
  min-width: 34px; height: 24px; padding: 0 7px; border-radius: 999px;
  font: 700 12px/1 var(--font, system-ui, sans-serif); font-variant-numeric: tabular-nums;
  border: 2px solid #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25), 0 3px 8px rgba(0,0,0,.18);
  transition: transform .15s ease;
}
.ss-map-pill.is-home { min-width: 44px; height: 30px; font-size: 14px; padding: 0 9px; border-width: 3px; }
.ss-map-pin-wrap:hover .ss-map-pill, .ss-map-pin-wrap:focus .ss-map-pill { transform: scale(1.12); }
.ss-map[data-map-theme="dark"] .ss-map-pill { border-color: #0b1220; box-shadow: 0 0 0 1px rgba(255,255,255,.25), 0 3px 10px rgba(0,0,0,.5); }

.ss-map-report {
  position: relative; display: block; width: 28px; height: 28px; box-sizing: border-box;
  border-radius: 50% 50% 50% 0; transform: rotate(-45deg);
  background: #7c3aed; border: 2px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,.3);
}
.ss-map-report > span { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; transform: rotate(45deg); font-size: 13px; line-height: 1; }
.ss-map[data-map-theme="dark"] .ss-map-report { border-color: #e9d5ff; }

.ss-map-picked {
  display: block; width: 26px; height: 26px; box-sizing: border-box;
  border-radius: 50% 50% 50% 0; transform: rotate(-45deg);
  background: var(--accent, #1d4ed8); border: 3px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,.35);
}
.ss-map.is-picking, .ss-map.is-picking .leaflet-interactive { cursor: crosshair; }

.ss-map .ss-map-tiles-dark { filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(85%) saturate(60%); }
.ss-map .ss-map-tiles-light { filter: saturate(70%) contrast(95%); }
.ss-map .leaflet-bar a, .ss-map .leaflet-control-layers {
  background: var(--surface, #fff); color: var(--text, #111827); border-color: var(--border, #e3e7ee);
}
.ss-map .leaflet-bar { border: 1px solid var(--border, #e3e7ee); box-shadow: var(--shadow, 0 1px 5px rgba(0,0,0,.2)); border-radius: var(--radius-sm, 10px); overflow: hidden; }
.ss-map .leaflet-bar a:hover, .ss-map .leaflet-bar a:focus { background: var(--surface-2, #f0f3f8); }
.ss-map .leaflet-bar a.leaflet-disabled { background: var(--surface, #fff); color: var(--muted, #5b6474); opacity: .5; }
.ss-map .leaflet-control-layers {
  border: 1px solid var(--border, #e3e7ee); border-radius: var(--radius-sm, 10px);
  box-shadow: var(--shadow, 0 1px 5px rgba(0,0,0,.2)); font: 13px/1.4 var(--font, system-ui, sans-serif);
}
.ss-map .leaflet-control-layers-expanded { padding: 8px 12px; }
.ss-map .leaflet-control-layers label { display: block; margin: 3px 0; cursor: pointer; }
.ss-map .leaflet-control-layers-selector { accent-color: var(--accent, #1d4ed8); margin: 0 6px 0 0; vertical-align: -1px; }
[dir="rtl"] .ss-map .leaflet-control-layers-selector { margin: 0 0 0 6px; }
.ss-map-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-inline-end: 6px; vertical-align: 0; }
.ss-map .leaflet-control-attribution { background: color-mix(in srgb, var(--surface, #fff) 80%, transparent); color: var(--muted, #5b6474); font-size: 10px; }
.ss-map .leaflet-control-attribution a { color: var(--muted, #5b6474); }
@media (prefers-reduced-motion: reduce) { .ss-map-pill { transition: none; } }
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* --------------------------------------------------------------- basemap */

function currentTheme() {
  const th = document.documentElement.dataset.theme;
  if (th === 'dark' || th === 'light') return th;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// CARTO may serve an identical "API key required" watermark image (HTTP 200) for
// every tile, which never fires `tileerror`. Probe two different Punjab tiles:
// if their bytes are identical (or the fetch fails), use OSM instead.
let cartoOk = null; // null = unknown, true/false once probed
let cartoProbe = null;

function probeCarto() {
  if (cartoProbe) return cartoProbe;
  const urls = [
    'https://a.basemaps.cartocdn.com/light_all/7/90/52.png',
    'https://b.basemaps.cartocdn.com/light_all/9/361/210.png',
  ];
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), 4000));
  const check = Promise.all(urls.map((u) => fetch(u, { mode: 'cors', cache: 'force-cache' })
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))))
    .then(([a, b]) => {
      if (a.byteLength !== b.byteLength) return true;
      const x = new Uint8Array(a);
      const y = new Uint8Array(b);
      for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return true;
      return false; // same image for different tiles = placeholder
    })
    .catch(() => false);
  cartoProbe = Promise.race([check, timeout]).then((ok) => { cartoOk = ok; return ok; });
  return cartoProbe;
}

function setBasemap(mode) {
  if (!map) return;
  const L = window.L;
  const theme = mode === 'dark' ? 'dark' : 'light';
  const useCarto = cartoOk === true;
  const key = useCarto ? theme : `osm-${theme}`;
  if (key === tileMode) return;
  if (tileLayer) tileLayer.remove();
  tileMode = key;
  tileErrors = 0;
  if (!useCarto) {
    // OSM fallback; darkened with a CSS filter in dark mode (see .ss-map-tiles-dark).
    tileLayer = L.tileLayer(TILES.osm, {
      maxZoom: 19,
      attribution: OSM_ATTR,
      className: theme === 'dark' ? 'ss-map-tiles-dark' : 'ss-map-tiles-light',
    });
  } else {
    tileLayer = L.tileLayer(TILES[theme], { subdomains: 'abcd', maxZoom: 19, attribution: CARTO_ATTR });
    tileLayer.on('tileerror', () => {
      tileErrors += 1;
      if (tileErrors >= TILE_ERROR_LIMIT && cartoOk) {
        cartoOk = false; // CARTO unreachable: use OSM for the rest of the session.
        setTimeout(() => setBasemap(currentMapTheme()), 0);
      }
    });
  }
  tileLayer.addTo(map);
  tileLayer.bringToBack();
}

function currentMapTheme() {
  return (map && map.getContainer().dataset.mapTheme) || currentTheme();
}

function applyTheme(theme) {
  if (!map) return;
  map.getContainer().dataset.mapTheme = theme;
  if (cartoOk === null) {
    probeCarto().then(() => setBasemap(currentMapTheme()));
    return;
  }
  setBasemap(theme);
}

function onThemeChange(e) {
  const th = e && e.detail && e.detail.theme;
  applyTheme(th === 'dark' || th === 'light' ? th : currentTheme());
}

/* ------------------------------------------------------------ layer control */

function overlayLabel(key, color) {
  return `<span class="ss-map-swatch" style="background:${color}"></span>${escapeHtml(tr(key))}`;
}

function buildLayerControl() {
  if (!map) return;
  const L = window.L;
  if (layerControl) layerControl.remove();
  const overlays = {};
  overlays[overlayLabel('map.layer.cities', 'linear-gradient(90deg,#00e400,#ffff00,#ff7e00,#ff0000,#8f3f97)')] = layers.cities;
  overlays[overlayLabel('map.layer.fires', 'radial-gradient(circle,#ea580c 40%,#fdba74)')] = layers.fires;
  overlays[overlayLabel('map.layer.reports', '#7c3aed')] = layers.reports;
  layerControl = L.control.layers(null, overlays, {
    collapsed: window.innerWidth < 640,
    position: 'topright',
  }).addTo(map);
}

/* ------------------------------------------------------------------- API */

export function isReady() {
  return !!map;
}

/**
 * Create the map inside `container`. Returns false if Leaflet is not available.
 * @param {HTMLElement} container
 * @param {{categoryOf?:(aqi:number)=>object, onPick?:(lat:number, lon:number)=>void}} options
 */
export function initMap(container, options = {}) {
  if (map) return true;
  if (typeof window.L === 'undefined' || !container) return false;
  opts = { ...opts, ...options };
  const L = window.L;
  injectStyles();
  container.classList.add('ss-map');
  const anim = !reducedMotion();
  map = L.map(container, {
    center: LAHORE,
    zoom: 6,
    zoomSnap: 0.5,
    preferCanvas: true,
    zoomAnimation: anim,
    fadeAnimation: anim,
    markerZoomAnimation: anim,
    scrollWheelZoom: false,
  });

  applyTheme(currentTheme());
  window.addEventListener('themechange', onThemeChange);
  if (typeof matchMedia === 'function') {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onMq = () => { if (!document.documentElement.dataset.theme) applyTheme(currentTheme()); };
    if (mq.addEventListener) mq.addEventListener('change', onMq);
  }

  // Show every city marker (Karachi … Peshawar); refined once real city data arrives.
  fitToCities(CITY_BOX);
  map.once('dragstart zoomstart', () => { userMoved = true; });

  layers = {
    fires: L.layerGroup().addTo(map),
    reports: L.layerGroup().addTo(map),
    cities: L.layerGroup().addTo(map),
  };
  buildLayerControl();

  map.on('click', (e) => {
    if (!reportMode) return;
    setPicked(e.latlng.lat, e.latlng.lng);
    if (typeof opts.onPick === 'function') opts.onPick(e.latlng.lat, e.latlng.lng);
  });
  // Enable scroll zoom only after the user focuses/clicks the map (avoids scroll traps).
  map.once('focus click mousedown touchstart', () => map.scrollWheelZoom.enable());

  renderAll();
  return true;
}

/** Fit the view so all city markers are visible, with padding for the AQI pills. */
function fitToCities(fallback) {
  if (!map) return;
  const L = window.L;
  const pts = (data.cities || []).filter((c) => typeof c.lat === 'number' && typeof c.lon === 'number').map((c) => [c.lat, c.lon]);
  const bounds = pts.length >= 2 ? L.latLngBounds(pts) : (fallback ? L.latLngBounds(fallback) : null);
  if (!bounds) return;
  bounds.extend(LAHORE);
  map.fitBounds(bounds, { padding: [36, 36], maxZoom: 8, animate: false });
  if (pts.length >= 2) didFitCities = true;
}

function renderCities() {
  if (!map || !data.cities) return;
  if (!didFitCities && !userMoved) fitToCities(CITY_BOX);
  const L = window.L;
  layers.cities.clearLayers();
  const ur = lang() === 'ur';
  data.cities.forEach((c) => {
    if (typeof c.lat !== 'number' || typeof c.lon !== 'number') return;
    const cat = categoryOf(c.aqi);
    const name = ur ? (c.nameUr || c.name) : c.name;
    const aqiText = Number.isFinite(c.aqi) ? String(Math.round(c.aqi)) : '–';
    const home = c.id === 'lahore';
    const w = home ? 52 : 40;
    const h = home ? 30 : 24;
    const icon = L.divIcon({
      className: 'ss-map-pin-wrap',
      html: `<span class="ss-map-pill${home ? ' is-home' : ''}" style="background:${escapeHtml(cat.color)};color:${escapeHtml(cat.textColor || '#000')}">${escapeHtml(aqiText)}</span>`,
      iconSize: [w, h],
      iconAnchor: [w / 2, h / 2],
      popupAnchor: [0, -h / 2],
    });
    const catName = ur ? cat.ur : cat.en;
    const m = L.marker([c.lat, c.lon], {
      icon,
      keyboard: true,
      title: `${name}: AQI ${aqiText}`,
      alt: `${name}: AQI ${aqiText}`,
      riseOnHover: true,
      zIndexOffset: home ? 1000 : 500,
    });
    m.bindPopup(() => popupContent(name, [
      Number.isFinite(c.pm25) ? ['PM2.5', `${Math.round(c.pm25)} µg/m³`] : null,
      c.time ? [tr('map.measured'), formatLocalStamp(c.time)] : null,
    ], { badge: { color: cat.color, textColor: cat.textColor, value: `AQI ${aqiText}`, label: catName || '' } }));
    m.addTo(layers.cities);
  });
}

function fireStyle(f) {
  const frp = Math.max(0, Number(f.frp) || 0);
  const r = Math.min(9, 3 + Math.sqrt(frp) * 0.8);
  const core = frp >= 20 ? '#dc2626' : frp >= 5 ? '#ea580c' : '#f59e0b';
  return { r, core };
}

function renderFires() {
  if (!map) return;
  const L = window.L;
  layers.fires.clearLayers();
  const fires = data.fires && Array.isArray(data.fires.fires) ? data.fires.fires : [];
  const source = (data.fires && data.fires.source) || 'NASA FIRMS';
  fires.slice(0, 3000).forEach((f) => {
    if (typeof f.lat !== 'number' || typeof f.lon !== 'number') return;
    const { r, core } = fireStyle(f);
    // Soft halo (non-interactive) + bright core = glowing dot.
    L.circleMarker([f.lat, f.lon], {
      radius: r * 2.1, stroke: false, fillColor: '#fb923c', fillOpacity: 0.22, interactive: false,
    }).addTo(layers.fires);
    const conf = formatConfidence(f.confidence);
    L.circleMarker([f.lat, f.lon], {
      radius: r, color: '#fff7ed', weight: 1, opacity: 0.9, fillColor: core, fillOpacity: 0.95,
    })
      .bindPopup(() => popupContent(tr('map.fire'), [
        f.date ? [tr('map.detected'), formatFireWhen(f.date, f.time)] : null,
        f.frp != null ? [tr('map.power'), String(f.frp)] : null,
        conf ? [tr('map.confidence'), conf] : null,
      ], { footer: `${tr('map.source')}: ${source}` }))
      .addTo(layers.fires);
  });
}

function reportMarker(r) {
  const L = window.L;
  const glyph = REPORT_ICONS[r.type] || REPORT_ICONS.other;
  const icon = L.divIcon({
    className: 'ss-map-pin-wrap',
    html: `<span class="ss-map-report"><span aria-hidden="true">${glyph}</span></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 34],
    popupAnchor: [0, -32],
  });
  const typeLabel = t(`report.types.${r.type}`);
  return L.marker([r.lat, r.lon], {
    icon, keyboard: true, title: typeLabel, alt: typeLabel, riseOnHover: true, zIndexOffset: 800,
  }).bindPopup(() => {
    const when = r.createdAt ? new Date(r.createdAt) : null;
    const whenText = when && !isNaN(when) ? when.toLocaleString(locale(), {
      timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }) : '';
    return popupContent(`${glyph} ${t(`report.types.${r.type}`)}`, [
      whenText ? [tr('map.reported'), whenText] : null,
    ], { note: r.note ? String(r.note) : null, footer: tr('map.report.title') });
  });
}

function renderReports() {
  if (!map) return;
  layers.reports.clearLayers();
  (data.reports || []).forEach((r) => {
    if (!r || typeof r.lat !== 'number' || typeof r.lon !== 'number') return;
    reportMarker(r).addTo(layers.reports);
  });
}

function renderAll() {
  renderCities();
  renderFires();
  renderReports();
}

export function setCities(cities) {
  data.cities = Array.isArray(cities) ? cities : null;
  renderCities();
}

export function setFires(firesResponse) {
  data.fires = firesResponse || null;
  renderFires();
}

export function setReports(reports) {
  data.reports = Array.isArray(reports) ? reports : [];
  renderReports();
}

export function addReport(report) {
  if (!report) return;
  data.reports = [...data.reports, report];
  if (map && typeof report.lat === 'number' && typeof report.lon === 'number') {
    if (!map.hasLayer(layers.reports)) layers.reports.addTo(map);
    const m = reportMarker(report).addTo(layers.reports);
    m.openPopup();
  }
}

/** Re-render popups/labels after a language change. */
export function refreshLabels() {
  if (!map) return;
  if (map.closePopup) map.closePopup();
  buildLayerControl();
  renderAll();
}

export function setReportMode(on) {
  reportMode = !!on;
  if (map) {
    map.getContainer().classList.toggle('is-picking', reportMode);
    if (!reportMode) clearPicked();
  }
}

export function setPicked(lat, lon, { pan = false } = {}) {
  if (!map) return;
  const L = window.L;
  if (pickedMarker) pickedMarker.remove();
  pickedMarker = L.marker([lat, lon], {
    icon: L.divIcon({
      className: 'ss-map-pin-wrap',
      html: '<span class="ss-map-picked" aria-hidden="true"></span>',
      iconSize: [26, 26],
      iconAnchor: [13, 32],
    }),
    keyboard: false,
    interactive: false,
    zIndexOffset: 2000,
  }).addTo(map);
  if (pan) map.setView([lat, lon], Math.max(map.getZoom(), 11), { animate: !reducedMotion() });
}

export function clearPicked() {
  if (pickedMarker) { pickedMarker.remove(); pickedMarker = null; }
}

export function invalidateSize() {
  if (map) map.invalidateSize();
}
