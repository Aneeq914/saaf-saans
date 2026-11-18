// Saaf Saans — app orchestrator: fetches live data, runs the in-browser model,
// renders every section and re-renders text on language / theme change.

import { t, getLang, setLang, onLangChange, initI18n } from './i18n.js';
import * as api from './api.js';
import * as mapView from './map.js';

const REFRESH_MS = 10 * 60 * 1000;
const PROFILE_KEY = 'saafsaans.profile';
const THEME_KEY = 'saafsaans.theme';
const WHO_PM25_24H = 15;
// WHO 2021 air-quality guidelines (µg/m³): 24-h means, O₃ 8-h peak, CO 24-h.
const WHO_GUIDE = { pm25: 15, pm10: 45, no2: 25, o3: 100, co: 4000 };
const POL_SHORT = { pm25: 'PM2.5', pm10: 'PM10', no2: 'NO₂', o3: 'O₃', co: 'CO' };
const TZ = 'Asia/Karachi';
const AQI_BOUNDS = [0, 50, 100, 150, 200, 300, 500];

const $ = (id) => document.getElementById(id);

// AI/ML modules are loaded dynamically so one failing module never breaks the page.
const mods = { aqi: null, forecast: null, advisor: null, policy: null };

const state = {
  cities: null,
  weather: null,
  history: null,
  fires: null,
  reports: [],
  forecast: null,
  forecastError: false,
  errors: {},
  lastUpdated: null,
  profile: readProfile(),
  chat: [],
  chatBusy: false,
  refreshing: false,
  picked: null,
  reportMode: false,
  policyRendered: false,
  policyAqi: null,
  themePref: readThemePref(),
};

let chart = null;

/* ------------------------------------------------------------------- icons */

const ICONS = {
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>',
  up: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  down: '<path d="m3 7 6 6 4-4 8 8"/><path d="M14 17h7v-7"/>',
  flat: '<path d="M3 12h17"/><path d="m15 7 5 5-5 5"/>',
  thermo: '<path d="M14 14.76V4a2 2 0 0 0-4 0v10.76a4 4 0 1 0 4 0z"/>',
  droplet: '<path d="M12 2.69s-6 6.6-6 11.31a6 6 0 0 0 12 0c0-4.71-6-11.31-6-11.31z"/>',
  wind: '<path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h6"/>',
  arrow: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  cloud: '<path d="M17.5 19H8a5 5 0 1 1 1-9.9A6 6 0 0 1 20.5 12a3.5 3.5 0 0 1-3 7z"/>',
  cloudSun: '<path d="M12 3v1.5M5.6 5.6l1 1M3 12h1.5M18.4 5.6l-1 1"/><path d="M8.5 10.5a4 4 0 0 1 7.3-1.6"/><path d="M17 20H9a4 4 0 1 1 .9-7.9A5 5 0 0 1 19.5 14 3 3 0 0 1 17 20z"/>',
  fog: '<path d="M4 9h16M3 13h18M5 17h14M8 5h8"/>',
  rain: '<path d="M17.5 15H8a5 5 0 1 1 1-9.9A6 6 0 0 1 20.5 8a3.5 3.5 0 0 1-3 7z"/><path d="m8 18-1 3M12 18l-1 3M16 18l-1 3"/>',
  snow: '<path d="M12 2v20M4.9 6.5l14.2 11M4.9 17.5l14.2-11"/>',
  storm: '<path d="M17.5 14H8a5 5 0 1 1 1-9.9A6 6 0 0 1 20.5 7a3.5 3.5 0 0 1-3 7z"/><path d="m12 14-2 4h4l-2 4"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  bars: '<path d="M6 20V11M12 20V4M18 20v-6M3 20h18"/>',
  pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  window: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M12 3v18M4 12h16"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.3 1.1 2.2h5c0-.9.5-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>',
};

function svgIcon(name) {
  const paths = ICONS[name];
  if (!paths) return '';
  return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

/** Fill every [data-icon] placeholder with its (constant, trusted) SVG. */
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((n) => {
    if (n.dataset.iconDone === n.dataset.icon) return;
    n.innerHTML = svgIcon(n.dataset.icon);
    n.dataset.iconDone = n.dataset.icon;
  });
}

function iconEl(name, cls = '') {
  const s = el('span', { class: cls || null, 'data-icon': name, 'aria-hidden': 'true' });
  s.innerHTML = svgIcon(name);
  s.dataset.iconDone = name;
  return s;
}

/* ---------------------------------------------------------------- helpers */

function readProfile() {
  try { return localStorage.getItem(PROFILE_KEY) || 'citizen'; } catch { return 'citizen'; }
}
function saveProfile(id) {
  try { localStorage.setItem(PROFILE_KEY, id); } catch { /* ignore */ }
}
function readThemePref() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* storage blocked */ }
  return 'system';
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fmt = (v, d = 0) => (isNum(v) ? v.toFixed(d) : '–');
const locale = () => (getLang() === 'ur' ? 'ur-PK' : 'en-GB');

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style') n.setAttribute('style', v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null || c === false) return;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return n;
}

function svgEl(tag, attrs = {}) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
}

/** Plain text with newlines → text nodes + <br>. Never uses innerHTML. */
function appendMultiline(node, text) {
  String(text ?? '').split('\n').forEach((line, i) => {
    if (i > 0) node.appendChild(document.createElement('br'));
    node.appendChild(document.createTextNode(line));
  });
}

function safeUrl(u) {
  try {
    const url = new URL(u, location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

/** "2026-11-18T14:00" → "14:00"; Dates / epoch → local Karachi time. */
function fmtHour(v) {
  if (v == null) return '–';
  if (typeof v === 'string') {
    const m = v.match(/T(\d{2}:\d{2})/);
    if (m) return m[1];
    if (/^\d{2}:\d{2}/.test(v)) return v.slice(0, 5);
  }
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

function fmtStamp(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleString(locale(), { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function textOf(x) {
  if (x == null || x === false) return '';
  if (typeof x === 'string' || typeof x === 'number') return String(x);
  return x.text || x.label || x.decision || x.title || '';
}

function fallbackCategory(aqi) {
  const table = [
    [50, 'good', '#00e400', '#000', 'Good', 'اچھی'],
    [100, 'moderate', '#ffff00', '#000', 'Moderate', 'معتدل'],
    [150, 'usg', '#ff7e00', '#000', 'Unhealthy for sensitive groups', 'حساس افراد کے لیے مضر'],
    [200, 'unhealthy', '#ff0000', '#fff', 'Unhealthy', 'مضرِ صحت'],
    [300, 'very_unhealthy', '#8f3f97', '#fff', 'Very unhealthy', 'انتہائی مضر'],
    [Infinity, 'hazardous', '#7e0023', '#fff', 'Hazardous', 'خطرناک'],
  ];
  const row = table.find((r) => aqi <= r[0]) || table[table.length - 1];
  return { key: row[1], color: row[2], textColor: row[3], en: row[4], ur: row[5] };
}

function categoryOf(aqi) {
  if (!isNum(aqi)) return { key: 'unknown', color: '#9ca3af', textColor: '#111', en: '–', ur: '–' };
  try {
    if (mods.aqi && typeof mods.aqi.aqiCategory === 'function') return mods.aqi.aqiCategory(aqi);
  } catch (e) { console.error(e); }
  return fallbackCategory(aqi);
}
const catLabel = (cat) => (getLang() === 'ur' ? cat.ur : cat.en);

function pmToAqi(pm) {
  if (!isNum(pm)) return null;
  try { if (mods.aqi?.pm25ToAqi) return mods.aqi.pm25ToAqi(pm); } catch { /* ignore */ }
  return null;
}

function announce(msg) {
  const n = $('sr-announcer');
  n.textContent = '';
  setTimeout(() => { n.textContent = msg; }, 50);
}

function showError(id, show, key = 'error.section') {
  const n = $(id);
  if (!n) return;
  n.hidden = !show;
  if (show) n.textContent = t(key);
}

function reveal(node) {
  if (!node || node.dataset.revealed) return;
  node.dataset.revealed = '1';
  node.classList.add('fade-in');
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/* ------------------------------------------------------------------- theme */

const darkMql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function resolvedTheme() {
  if (state.themePref === 'light' || state.themePref === 'dark') return state.themePref;
  return darkMql?.matches ? 'dark' : 'light';
}

function applyTheme({ force = false } = {}) {
  const root = document.documentElement;
  const theme = resolvedTheme();
  const prev = root.getAttribute('data-theme');
  root.setAttribute('data-theme', theme);
  const meta = $('meta-theme');
  if (meta) meta.setAttribute('content', cssVar('--bg', theme === 'dark' ? '#0a101c' : '#f4f6f9'));
  renderThemeToggle();
  if (force || prev !== theme) {
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }
}

function renderThemeToggle() {
  const btn = $('theme-toggle');
  const icon = $('theme-icon');
  if (!btn || !icon) return;
  const pref = state.themePref;
  icon.dataset.icon = pref === 'light' ? 'sun' : pref === 'dark' ? 'moon' : 'monitor';
  hydrateIcons(btn);
  const label = t('theme.toggle', { mode: t(`theme.${pref}`) });
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

function initTheme() {
  $('theme-toggle').addEventListener('click', () => {
    const order = ['system', 'light', 'dark'];
    state.themePref = order[(order.indexOf(state.themePref) + 1) % order.length];
    try { localStorage.setItem(THEME_KEY, state.themePref); } catch { /* ignore */ }
    applyTheme();
    announce(t('theme.toggle', { mode: t(`theme.${state.themePref}`) }));
  });
  const onOs = () => { if (state.themePref === 'system') applyTheme(); };
  if (darkMql) {
    if (darkMql.addEventListener) darkMql.addEventListener('change', onOs);
    else if (darkMql.addListener) darkMql.addListener(onOs);
  }
  window.addEventListener('themechange', () => { renderChart(); });
  applyTheme({ force: true });
}

/* ------------------------------------------------- nav & scroll affordances */

function updateFade(wrap, scroller) {
  const max = scroller.scrollWidth - scroller.clientWidth;
  const pos = Math.abs(scroller.scrollLeft);
  wrap.classList.toggle('can-start', max > 2 && pos > 2);
  wrap.classList.toggle('can-end', max > 2 && pos < max - 2);
}

const fadePairs = [];
function registerFade(wrap, scroller) {
  if (!wrap || !scroller) return;
  const upd = () => updateFade(wrap, scroller);
  fadePairs.push(upd);
  scroller.addEventListener('scroll', upd, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(upd).observe(scroller);
  upd();
}
const updateFades = () => fadePairs.forEach((f) => f());

function initNav() {
  const nav = $('site-nav');
  const list = $('nav-list');
  registerFade(nav, list);
  document.querySelectorAll('[data-fade]').forEach((w) => registerFade(w, w.firstElementChild));
  window.addEventListener('resize', updateFades, { passive: true });

  // Keep the scroll offset in sync with the real header height.
  const header = document.querySelector('.site-header');
  const setH = () => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
  setH();
  if ('ResizeObserver' in window) new ResizeObserver(setH).observe(header);

  const links = [...list.querySelectorAll('a[href^="#"]')];
  const sections = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
  if (!('IntersectionObserver' in window) || !sections.length) return;
  const visible = new Set();
  let current = null;
  const setActive = (id) => {
    if (id === current) return;
    current = id;
    links.forEach((a) => {
      const on = a.getAttribute('href') === `#${id}`;
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      if (on) {
        const lr = a.getBoundingClientRect();
        const ur = list.getBoundingClientRect();
        const delta = (lr.left + lr.width / 2) - (ur.left + ur.width / 2);
        if (Math.abs(delta) > 4) list.scrollBy({ left: delta, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    });
  };
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) visible.add(en.target.id); else visible.delete(en.target.id); });
    const first = sections.find((s) => visible.has(s.id));
    if (first) setActive(first.id);
  }, { rootMargin: `-${header.offsetHeight + 8}px 0px -55% 0px`, threshold: 0 });
  sections.forEach((s) => io.observe(s));
}

/* ----------------------------------------------------------- current data */

function getCurrent() {
  const lahore = state.cities?.cities?.find((c) => c.id === 'lahore') || null;
  const cur = {
    aqi: lahore?.aqi, pm25: lahore?.pm25, pm10: lahore?.pm10, no2: lahore?.no2,
    o3: lahore?.o3, co: lahore?.co, time: lahore?.time, fromHistory: false,
  };
  if (!isNum(cur.aqi) && state.history?.hourly) {
    const h = state.history.hourly;
    const i = state.history.nowIndex;
    if (isNum(i)) {
      cur.pm25 = h.pm25?.[i];
      cur.pm10 = h.pm10?.[i];
      cur.aqi = isNum(h.aqi?.[i]) ? h.aqi[i]
        : (isNum(cur.pm25) && mods.aqi?.pm25ToAqi ? mods.aqi.pm25ToAqi(cur.pm25) : undefined);
      cur.time = h.time?.[i];
      cur.fromHistory = true;
    }
  }
  return cur;
}

/** Hourly AQI right now (from PM2.5) so it compares fairly with the hourly forecast. */
function currentHourlyAqi() {
  const cur = getCurrent();
  const h = pmToAqi(cur.pm25);
  return isNum(h) ? h : (isNum(cur.aqi) ? Math.round(cur.aqi) : null);
}

function forecastExtremes() {
  const preds = state.forecast?.predictions?.filter((p) => isNum(p.aqi)) || [];
  if (!preds.length) return null;
  let worst = preds[0];
  let best = preds[0];
  preds.forEach((p) => { if (p.aqi > worst.aqi) worst = p; if (p.aqi < best.aqi) best = p; });
  return { worst, best };
}

/* ------------------------------------------------------------------ header */

function renderHeader() {
  const lu = $('last-updated');
  if (state.lastUpdated) {
    lu.textContent = state.lastUpdated.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
    lu.setAttribute('datetime', state.lastUpdated.toISOString());
  }
  const toggle = $('lang-toggle');
  toggle.setAttribute('lang', getLang() === 'ur' ? 'en' : 'ur');
  renderThemeToggle();

  const cur = getCurrent();
  const pill = $('aqi-pill');
  if (isNum(cur.aqi)) {
    const cat = categoryOf(cur.aqi);
    $('aqi-pill-value').textContent = String(Math.round(cur.aqi));
    pill.setAttribute('aria-label', t('header.aqiPillLabel', { n: Math.round(cur.aqi), cat: catLabel(cat) }));
  }
  renderOfflineBanner();
}

function renderOfflineBanner() {
  const banner = $('offline-banner');
  const fromCache = [state.cities, state.weather, state.history].some((d) => d && (d._fromCache || d.stale));
  const allFailed = ['cities', 'weather', 'history'].every((k) => state.errors[k]);
  let key = null;
  if (!navigator.onLine) key = 'offline.banner';
  else if (fromCache || allFailed) key = 'offline.stale';
  banner.hidden = !key;
  if (key) banner.textContent = t(key);
}

/* -------------------------------------------------------------------- hero */

function gaugeFrac(aqi) {
  const v = Math.max(0, Math.min(500, aqi));
  for (let i = 0; i < AQI_BOUNDS.length - 1; i++) {
    const lo = AQI_BOUNDS[i];
    const hi = AQI_BOUNDS[i + 1];
    if (v <= hi) return (i + (v - lo) / (hi - lo)) / (AQI_BOUNDS.length - 1);
  }
  return 1;
}

const G = { cx: 120, cy: 118, r: 96 };
const gPoint = (f) => [G.cx - G.r * Math.cos(Math.PI * f), G.cy - G.r * Math.sin(Math.PI * f)];
const gArc = (f1, f2) => {
  const [x1, y1] = gPoint(f1);
  const [x2, y2] = gPoint(f2);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${G.r} ${G.r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

function buildGauge() {
  const svg = $('gauge');
  if (svg.dataset.built) return;
  svg.dataset.built = '1';
  const n = AQI_BOUNDS.length - 1;
  for (let i = 0; i < n; i++) {
    const cat = categoryOf((AQI_BOUNDS[i] + AQI_BOUNDS[i + 1]) / 2);
    const gap = 0.006;
    svg.appendChild(svgEl('path', { class: 'g-track', d: gArc(i / n + (i ? gap : 0), (i + 1) / n - (i < n - 1 ? gap : 0)), stroke: cat.color }));
  }
  svg.appendChild(svgEl('path', { class: 'g-value', id: 'g-value', d: gArc(0, 1), pathLength: '100', 'stroke-dasharray': '0 100', stroke: 'transparent' }));
  const [mx, my] = gPoint(0);
  svg.appendChild(svgEl('circle', { class: 'g-marker', id: 'g-marker', cx: mx, cy: my, r: 11, fill: 'transparent', stroke: 'transparent' }));
  const t0 = svgEl('text', { class: 'g-tick', x: 24, y: 143, 'text-anchor': 'middle' }); t0.textContent = '0';
  const t1 = svgEl('text', { class: 'g-tick', x: 216, y: 143, 'text-anchor': 'middle' }); t1.textContent = '500';
  svg.append(t0, t1);
}

function renderGauge(aqi, cat) {
  buildGauge();
  const f = gaugeFrac(aqi);
  const val = $('g-value');
  const mk = $('g-marker');
  val.setAttribute('stroke', cat.color);
  // next frame so the CSS transition animates from 0 on first render
  requestAnimationFrame(() => {
    val.setAttribute('stroke-dasharray', `${(f * 100).toFixed(2)} 100`);
    const [x, y] = gPoint(f);
    mk.setAttribute('cx', x.toFixed(2));
    mk.setAttribute('cy', y.toFixed(2));
    mk.setAttribute('fill', cat.color);
    mk.removeAttribute('stroke');
  });
}

const VERDICT = {
  good: ['ok', 'check'],
  moderate: ['ok', 'check'],
  usg: ['caution', 'alert'],
  unhealthy: ['no', 'alert'],
  very_unhealthy: ['no', 'home'],
  hazardous: ['no', 'home'],
};

function renderHero() {
  const cur = getCurrent();
  const block = $('aqi-block');
  const hasData = isNum(cur.aqi);
  block.setAttribute('aria-busy', String(!hasData && !state.errors.cities));

  const valueEl = $('aqi-value');
  const badge = $('aqi-badge');
  const verdict = $('verdict');
  const answer = $('safe-outside');
  const why = $('verdict-why');
  const vIcon = $('verdict-icon');

  if (hasData) {
    const cat = categoryOf(cur.aqi);
    const root = document.documentElement;
    root.style.setProperty('--cat', cat.color);
    root.style.setProperty('--cat-text', cat.textColor);
    valueEl.textContent = String(Math.round(cur.aqi));
    badge.textContent = catLabel(cat);
    badge.hidden = false;
    renderGauge(cur.aqi, cat);
    const [tone, ico] = VERDICT[cat.key] || ['unknown', 'question'];
    verdict.dataset.tone = tone;
    vIcon.textContent = '';
    vIcon.appendChild(iconEl(ico));
    answer.textContent = t(`verdict.${cat.key}`);
    why.textContent = t(`health.${cat.key}`);
    reveal(block);
    reveal($('verdict'));
  } else if (state.errors.cities && !state.history) {
    valueEl.textContent = '–';
    badge.hidden = true;
    verdict.dataset.tone = 'unknown';
    vIcon.textContent = '';
    vIcon.appendChild(iconEl('question'));
    answer.textContent = t('verdict.unknown');
    why.textContent = t('safe.unknown');
  }

  // Source line
  const src = $('hero-source');
  src.textContent = '';
  if (state.cities?.source) {
    const href = safeUrl(state.cities.sourceUrl);
    src.append(`${t('source')}: `);
    src.append(href ? el('a', { href, target: '_blank', rel: 'noopener', text: state.cities.source }) : state.cities.source);
    if (cur.time) src.append(` · ${t('hero.measuredAt', { time: fmtHour(cur.time) })}`);
  } else if (cur.fromHistory) {
    src.textContent = t('hero.fromHistory');
  }

  renderTrend();
  renderPollutants(cur, hasData);
  renderWeather();
  showError('hero-error', !!state.errors.cities && !hasData);
}

function renderTrend() {
  const ans = $('trend-answer');
  const detail = $('trend-detail');
  const bars = $('trend-bars');
  const preds = (state.forecast?.predictions || []).filter((p) => isNum(p.aqi)).slice(0, 6);
  const now = currentHourlyAqi();
  if (!preds.length || !isNum(now)) {
    if (mods.loaded && state.history !== null && !state.forecast) {
      ans.className = 'trend-answer';
      ans.textContent = t('trend.na');
      detail.textContent = '';
      bars.textContent = '';
    } else if (state.errors.history) {
      ans.textContent = t('trend.na');
    }
    return;
  }
  const vals = preds.map((p) => p.aqi);
  const peak = Math.max(...vals);
  const low = Math.min(...vals);
  let dir = 'flat';
  let to = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  if (peak >= now + 20) { dir = 'up'; to = peak; } else if (low <= now - 20) { dir = 'down'; to = low; }
  ans.className = `trend-answer is-${dir}`;
  ans.textContent = '';
  ans.append(iconEl(dir, 'flip-rtl'), el('span', { text: t(`trend.${dir}`) }));
  detail.textContent = t('trend.detail', { from: Math.round(now), to: Math.round(to) });

  bars.textContent = '';
  const series = [{ time: getCurrent().time, aqi: now }, ...preds];
  // Scale between a floor below the lowest hour and the highest hour so changes are visible.
  const hi = Math.max(...series.map((p) => p.aqi));
  const lo = Math.max(0, Math.min(...series.map((p) => p.aqi)) - 40);
  series.forEach((p) => {
    const c = categoryOf(p.aqi);
    const pct = hi > lo ? 20 + ((p.aqi - lo) / (hi - lo)) * 80 : 100;
    bars.appendChild(el('li', { title: `${fmtHour(p.time)} · AQI ${Math.round(p.aqi)}` }, [
      el('span', { class: 'tb-bar', style: `height:${pct.toFixed(0)}%;background:${c.color}` }),
      el('span', { class: 'tb-h', text: fmtHour(p.time).slice(0, 2) }),
    ]));
  });
  reveal($('trend'));
}

function renderPollutants(cur, hasData) {
  const pol = $('pollutants');
  pol.textContent = '';
  if (!hasData && cur.pm25 == null) {
    if (!state.errors.cities) for (let i = 0; i < 4; i++) pol.appendChild(el('li', {}, el('span', { class: 'skeleton skeleton-tile' })));
    return;
  }
  ['pm25', 'pm10', 'no2', 'o3', 'co'].forEach((k) => {
    const v = cur[k];
    if (!isNum(v)) return;
    const g = WHO_GUIDE[k];
    const r = v / g;
    const lvl = r <= 1 ? 'ok' : r <= 2 ? 'mid' : 'high';
    const color = lvl === 'ok' ? 'var(--ok)' : lvl === 'mid' ? 'var(--caution)' : 'var(--no)';
    const xText = r <= 1 ? '✓' : t('pol.whoShort', { n: r.toFixed(1) });
    const status = r <= 1 ? t('pol.ok') : t('pol.whoTimes', { n: r.toFixed(1) });
    pol.appendChild(el('li', { class: 'pol', title: `${t(`pol.${k}`)} · ${t('pol.whoGuide', { n: g })}` }, [
      el('span', { class: 'pol-top' }, [
        el('span', { class: 'pol-name', text: POL_SHORT[k] }),
        el('span', { class: `pol-x lvl-${lvl}`, 'aria-hidden': 'true' }, xText.includes('×') ? el('span', { class: 'num', text: xText }) : xText),
      ]),
      el('span', { class: 'pol-val num' }, [`${fmt(v, 0)} `, el('small', { text: 'µg/m³' })]),
      el('span', { class: 'pol-bar', 'aria-hidden': 'true' }, [
        el('span', { style: `width:${(Math.min(r / 4, 1) * 100).toFixed(1)}%;background:${color}` }),
        el('i', { style: 'left:25%' }),
      ]),
      el('span', { class: 'sr-only', text: `${t(`pol.${k}`)}: ${status}` }),
    ]));
  });
  reveal(pol);
}

function compass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

function weatherKind(code, time) {
  const h = parseInt(String(time || '').slice(11, 13), 10);
  const night = isNum(h) && (h >= 18 || h < 6);
  if (!isNum(code)) return null;
  if (code === 0) return ['wx.clear', night ? 'moon' : 'sun'];
  if (code <= 2) return ['wx.partly', night ? 'cloud' : 'cloudSun'];
  if (code === 3) return ['wx.cloudy', 'cloud'];
  if (code === 45 || code === 48) return ['wx.fog', 'fog'];
  if (code >= 51 && code <= 57) return ['wx.drizzle', 'rain'];
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['wx.rain', 'rain'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['wx.snow', 'snow'];
  if (code >= 95) return ['wx.storm', 'storm'];
  return ['wx.cloudy', 'cloud'];
}

function renderWeather() {
  const ul = $('weather');
  ul.textContent = '';
  const w = state.weather?.current;
  const warn = $('visibility-warning');
  if (!w) {
    warn.hidden = true;
    if (state.errors.weather) ul.appendChild(el('li', { class: 'muted', text: t('weather.unavailable') }));
    else for (let i = 0; i < 4; i++) ul.appendChild(el('li', {}, el('span', { class: 'skeleton skeleton-tile' })));
    return;
  }
  const item = (icon, value, label, extraCls) => el('li', { class: `wx${extraCls ? ` ${extraCls}` : ''}` }, [
    icon,
    el('span', { class: 'wx-text' }, [
      el('span', { class: 'wx-value num', text: value }),
      el('span', { class: 'wx-label', text: label }),
    ]),
  ]);
  if (isNum(w.temperature)) {
    const kind = weatherKind(w.weatherCode, w.time);
    ul.appendChild(item(iconEl(kind ? kind[1] : 'thermo'), `${fmt(w.temperature, 0)}°C`, kind ? t(kind[0]) : t('weather.temp')));
  }
  if (isNum(w.humidity)) ul.appendChild(item(iconEl('droplet'), `${fmt(w.humidity, 0)}%`, t('weather.humidity')));
  if (isNum(w.windSpeed)) {
    const ic = iconEl('arrow');
    const svg = ic.querySelector('svg');
    if (isNum(w.windDirection) && svg) {
      svg.classList.add('wind-arrow');
      svg.style.transform = `rotate(${(w.windDirection + 180) % 360}deg)`;
    }
    const label = isNum(w.windDirection) ? `${t('weather.wind')} · ${t('weather.windFrom', { dir: t(`dir.${compass(w.windDirection)}`) })}` : t('weather.wind');
    ul.appendChild(item(ic, `${fmt(w.windSpeed, 0)} km/h`, label));
  }
  if (isNum(w.visibility)) {
    const v = w.visibility >= 1000 ? `${(w.visibility / 1000).toFixed(1)} km` : `${Math.round(w.visibility)} m`;
    ul.appendChild(item(iconEl('eye'), v, t('weather.visibility'), w.visibility < 1000 ? 'is-warn' : ''));
  }
  const low = isNum(w.visibility) && w.visibility < 1000;
  warn.hidden = !low;
  if (low) {
    warn.textContent = '';
    warn.append(iconEl('alert'), el('span', { text: t('vis.warning') }));
  }
  reveal(ul);
}

/* ---------------------------------------------------------------- profiles */

function renderProfiles() {
  const wrap = $('profiles');
  wrap.textContent = '';
  const profiles = mods.advisor?.PROFILES;
  if (!Array.isArray(profiles) || !profiles.length) return;
  if (!profiles.some((p) => p.id === state.profile)) state.profile = profiles[0].id;
  profiles.forEach((p) => {
    const btn = el('button', {
      type: 'button',
      class: 'chip-btn',
      'aria-pressed': String(p.id === state.profile),
      'data-profile': p.id,
    }, [
      el('span', { class: 'chip-icon', 'aria-hidden': 'true', text: p.icon || '' }),
      el('span', { text: getLang() === 'ur' ? p.ur : p.en }),
    ]);
    btn.addEventListener('click', () => {
      state.profile = p.id;
      saveProfile(p.id);
      wrap.querySelectorAll('[data-profile]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.profile === p.id)));
      renderAdvice();
    });
    wrap.appendChild(btn);
  });
  const active = wrap.querySelector('[aria-pressed="true"]');
  if (active && wrap.scrollWidth > wrap.clientWidth) {
    const lr = active.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    if (lr.right > wr.right || lr.left < wr.left) wrap.scrollLeft += (lr.left + lr.width / 2) - (wr.left + wr.width / 2);
  }
  updateFades();
}

const BEST_TITLES = ['Best time outside', 'باہر جانے کا بہترین وقت'];
const isMaskItem = (it) => it.icon === '😷' || /mask|ماسک/i.test(it.title || '');

/** "AQI 168 — Unhealthy. Avoid outdoor exertion… Forecast: …" → just the action. */
function shortHeadline(h) {
  let s = String(h || '');
  const m = s.match(/^AQI[^.۔]*[.۔]\s+/);
  if (m) s = s.slice(m[0].length);
  s = s.replace(/\s*(Forecast:|پیشگوئی:).*$/, '');
  return s.trim() || String(h || '');
}

function renderAdvice() {
  const box = $('advice-card');
  const cur = getCurrent();
  if (!mods.advisor || typeof mods.advisor.getAdvice !== 'function') {
    if (mods.loaded) { box.textContent = ''; box.appendChild(el('p', { class: 'muted', text: t('advice.error') })); }
    return;
  }
  if (!isNum(cur.aqi)) {
    if (state.errors.cities && !state.history) {
      box.textContent = '';
      box.appendChild(el('p', { class: 'muted', text: t('advice.waiting') }));
    }
    return;
  }
  let advice;
  try {
    advice = mods.advisor.getAdvice({
      profile: state.profile,
      current: { aqi: cur.aqi, pm25: cur.pm25 },
      predictions: state.forecast?.predictions || [],
      weather: state.weather?.current || null,
      lang: getLang(),
    });
  } catch (e) {
    console.error('getAdvice failed', e);
    box.textContent = '';
    box.appendChild(el('p', { class: 'muted', text: t('advice.error') }));
    return;
  }
  if (!advice) return;

  box.textContent = '';

  // 1. Verdict line + risk pill + ventilation status
  const top = el('div', { class: 'advice-top' }, [
    el('p', { class: 'advice-line', text: shortHeadline(advice.headline) }),
    advice.levelLabel ? el('span', { class: `level-pill level-${advice.level || 'moderate'}`, text: advice.levelLabel }) : null,
  ]);
  if (advice.ventilate) {
    const ok = !!advice.ventilate.ok;
    top.appendChild(el('span', { class: `status-pill ${ok ? 'pill-ok' : 'pill-no'}`, title: advice.ventilate.text || null }, [
      iconEl('window'), t(ok ? 'advice.ventOk' : 'advice.ventNo'),
    ]));
  }
  box.appendChild(top);

  // 2. Item cards (deduplicated: best times live in the timeline below)
  const items = (Array.isArray(advice.items) ? advice.items : [])
    .filter((it) => !BEST_TITLES.includes(it.title))
    .map((it) => ({
      ...it,
      text: String(it.text || '')
        .replace(/\s*Cleanest window: [^.]*\./, '')
        .replace(/\s*سب سے صاف وقت: [^۔]*۔/, ''),
    }));
  if (advice.mask && !items.some(isMaskItem)) items.push({ icon: '😷', title: t('advice.mask'), text: textOf(advice.mask) });
  const sd = textOf(advice.schoolDecision);
  if (sd && !items.some((it) => it.icon === '🏫' || String(it.text).includes(sd))) items.push({ icon: '🏫', title: t('advice.school'), text: sd });

  if (items.length) {
    const ul = el('ul', { class: 'advice-grid' });
    items.forEach((it) => {
      const body = el('div');
      if (it.title) body.appendChild(el('strong', { text: it.title }));
      if (it.text) { const p = el('p'); appendMultiline(p, it.text); body.appendChild(p); }
      ul.appendChild(el('li', { class: 'advice-item' }, [el('span', { class: 'advice-icon', 'aria-hidden': 'true', text: it.icon || '•' }), body]));
    });
    box.appendChild(ul);
  }

  // 3. Best windows, shown once as a timeline
  box.appendChild(renderWindows(Array.isArray(advice.bestWindows) ? advice.bestWindows : []));

  if (advice.disclaimer) box.appendChild(el('p', { class: 'advice-disclaimer', text: advice.disclaimer }));
  reveal(box);
}

function renderWindows(wins) {
  const wrap = el('div', { class: 'windows' }, [
    el('h3', { class: 'windows-head' }, [iconEl('clock'), t('advice.windows')]),
  ]);
  const preds = (state.forecast?.predictions || []).slice(0, 24);
  if (preds.length >= 12) {
    const keyOf = (time) => String(time).slice(0, 16);
    const best = new Set();
    wins.forEach((w) => {
      const i = preds.findIndex((p) => keyOf(p.time) === `${w.date}T${w.start}`);
      if (i >= 0) { best.add(i); best.add(i + 1); }
    });
    const strip = el('div', { class: 'tl-strip' });
    preds.forEach((p, i) => {
      const c = categoryOf(p.aqi);
      strip.appendChild(el('span', {
        class: `tl-cell${best.has(i) ? ' is-best' : ''}`,
        style: `background:${c.color}`,
        title: `${fmtHour(p.time)} · AQI ${isNum(p.aqi) ? Math.round(p.aqi) : '–'}`,
      }));
    });
    const labels = el('div', { class: 'tl-labels' });
    for (let i = 0; i < preds.length; i += 6) labels.appendChild(el('span', { text: fmtHour(preds[i].time) }));
    wrap.appendChild(el('div', { class: 'timeline', 'aria-hidden': 'true' }, [strip, labels]));
  }
  if (wins.length) {
    const ul = el('ul', { class: 'windows-list' });
    wins.forEach((w) => {
      const c = categoryOf(w.avgAqi);
      ul.appendChild(el('li', {}, [
        el('span', { class: 'dot', style: `background:${c.color}`, 'aria-hidden': 'true' }),
        el('span', { class: 'num window-time', text: `${fmtHour(w.start)}–${fmtHour(w.end)}` }),
        el('span', { class: 'muted', text: t('advice.avgAqi', { n: fmt(w.avgAqi, 0) }) }),
      ]));
    });
    wrap.appendChild(ul);
  } else {
    wrap.appendChild(el('p', { class: 'muted small', style: 'margin:8px 0 0', text: t('advice.noWindows') }));
  }
  return wrap;
}

/* ---------------------------------------------------------------- forecast */

function renderForecast() {
  const summary = $('forecast-summary');
  summary.textContent = '';
  const ex = forecastExtremes();
  if (ex) {
    const pill = (key, p) => {
      const c = categoryOf(p.aqi);
      return el('span', { class: 'fs-pill' }, [
        el('span', { class: 'dot', style: `background:${c.color}`, 'aria-hidden': 'true' }),
        el('span', { text: `${t(key)}:` }),
        el('b', { class: 'num', text: fmtHour(p.time) }),
        el('span', { class: 'num muted', text: `AQI ${Math.round(p.aqi)}` }),
      ]);
    };
    summary.append(pill('forecast.worst', ex.worst), pill('forecast.best', ex.best));
  } else if (!state.forecast && state.history && mods.loaded) {
    summary.appendChild(el('p', { class: 'fs-note', text: t('forecast.noModel') }));
  }
  renderHourStrip();
  renderChart();
  renderMetrics();
  showError('forecast-error', !!state.errors.history && !state.history, 'error.section');
}

function renderHourStrip() {
  const ol = $('hour-strip');
  const preds = (state.forecast?.predictions || []).slice(0, 24);
  ol.textContent = '';
  if (!preds.length) {
    if (!state.history && !state.errors.history) {
      for (let i = 0; i < 8; i++) ol.appendChild(el('li', { class: 'hour' }, el('span', { class: 'skeleton', style: 'width:40px;height:56px' })));
    } else {
      ol.closest('[data-fade]').hidden = true;
      ol.closest('[data-fade]').previousElementSibling.hidden = true;
    }
    return;
  }
  ol.closest('[data-fade]').hidden = false;
  ol.closest('[data-fade]').previousElementSibling.hidden = false;
  const now = currentHourlyAqi();
  const chip = (label, aqi, isNow, labelIsText) => {
    const c = categoryOf(aqi);
    return el('li', { class: `hour${isNow ? ' is-now' : ''}`, 'aria-label': `${label}: AQI ${isNum(aqi) ? Math.round(aqi) : '–'}, ${catLabel(c)}` }, [
      el('span', { class: `hour-t${labelIsText ? '' : ' num'}`, text: label }),
      el('span', { class: 'hour-dot', style: `background:${c.color}`, 'aria-hidden': 'true' }),
      el('span', { class: 'hour-v num', text: isNum(aqi) ? String(Math.round(aqi)) : '–' }),
    ]);
  };
  if (isNum(now)) ol.appendChild(chip(t('forecast.now'), now, true, true));
  preds.forEach((p) => ol.appendChild(chip(fmtHour(p.time), p.aqi, false, false)));
  reveal(ol);
  updateFades();
}

function alpha(color, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function renderChart() {
  const canvas = $('forecast-chart');
  const fallback = $('chart-fallback');
  const hist = state.history;
  if (!hist?.hourly?.time || !isNum(hist.nowIndex)) return;
  if (typeof window.Chart === 'undefined') {
    fallback.hidden = false;
    fallback.textContent = t('forecast.chartUnavailable');
    canvas.hidden = true;
    return;
  }
  fallback.hidden = true;
  canvas.hidden = false;

  const h = hist.hourly;
  const now = hist.nowIndex;
  const start = Math.max(0, now - 47);
  const preds = state.forecast?.predictions || [];
  const end = Math.max(Math.min(h.time.length - 1, now + 24), now + preds.length);
  const labels = [];
  const actual = [];
  const cams = [];
  const model = [];
  for (let i = start; i <= end; i++) {
    labels.push(h.time[i] ?? preds[i - now - 1]?.time ?? '');
    const v = h.pm25?.[i];
    actual.push(i <= now && isNum(v) ? v : null);
    cams.push(i >= now && i <= now + 24 && isNum(v) ? v : null);
    if (i === now && preds.length) model.push(isNum(v) ? v : null);
    else if (i > now && preds[i - now - 1] && isNum(preds[i - now - 1].pm25)) model.push(preds[i - now - 1].pm25);
    else model.push(null);
  }
  const nowPos = now - start;

  const text = cssVar('--text', '#0f172a');
  const muted = cssVar('--muted', '#566074');
  const grid = cssVar('--border', '#e1e6ee');
  const surface = cssVar('--surface', '#ffffff');
  const accent = cssVar('--accent', '#0f766e');
  const cam = cssVar('--cams', '#a16207');
  const ok = cssVar('--ok', '#15803d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const font = { family: 'Inter, system-ui, sans-serif', size: 12 };

  const nowLine = {
    id: 'nowLine',
    afterDatasetsDraw(c) {
      const x = c.scales.x.getPixelForValue(nowPos);
      const { top, bottom } = c.chartArea;
      const ctx = c.ctx;
      ctx.save();
      ctx.strokeStyle = muted;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, top + 18); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.setLineDash([]);
      const label = t('forecast.now');
      ctx.font = `600 11px ${getLang() === 'ur' ? '"Noto Nastaliq Urdu", serif' : font.family}`;
      const w = ctx.measureText(label).width + 14;
      ctx.fillStyle = text;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - w / 2, top, w, 18, 9); else ctx.rect(x - w / 2, top, w, 18);
      ctx.fill();
      ctx.fillStyle = surface;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, top + 9.5);
      ctx.restore();
    },
  };

  if (chart) { chart.destroy(); chart = null; }
  chart = new window.Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: t('forecast.actual'), data: actual, borderColor: text, backgroundColor: alpha(text, 0.06), fill: 'origin', borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.3 },
        { label: t('forecast.model'), data: model, borderColor: accent, backgroundColor: accent, borderWidth: 3, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 4, tension: 0.3 },
        { label: t('forecast.cams'), data: cams, borderColor: cam, backgroundColor: cam, borderWidth: 1.75, borderDash: [2, 3], pointRadius: 0, pointHoverRadius: 3, tension: 0.3 },
        { label: t('forecast.who'), data: labels.map(() => WHO_PM25_24H), borderColor: ok, backgroundColor: ok, borderWidth: 1, pointRadius: 0, pointHoverRadius: 0, borderDash: [1, 4] },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduced ? false : { duration: 500 },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 4 } },
      plugins: {
        legend: {
          position: 'top', align: 'start',
          labels: { color: text, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 14, font },
        },
        tooltip: {
          backgroundColor: surface, titleColor: text, bodyColor: text, borderColor: grid, borderWidth: 1,
          padding: 10, cornerRadius: 10, usePointStyle: true, boxPadding: 4, titleFont: { ...font, weight: '700' }, bodyFont: font,
          filter: (item) => item.raw != null && item.datasetIndex !== 3,
          callbacks: {
            title: (items) => {
              const s = items[0]?.label || '';
              return s.length >= 16 ? `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}` : s;
            },
            label: (item) => ` ${item.dataset.label}: ${Math.round(item.raw)} µg/m³`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 7, font,
            callback(value) {
              const s = this.getLabelForValue(value) || '';
              const hh = fmtHour(s);
              return hh === '00:00' && s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : hh;
            },
          },
          grid: { display: false },
          border: { color: grid },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: t('forecast.unit'), color: muted, font },
          ticks: { color: muted, font, maxTicksLimit: 6 },
          grid: { color: alpha(grid.startsWith('#') ? grid : '#e1e6ee', 0.8) },
          border: { display: false },
        },
      },
    },
    plugins: [nowLine],
  });
}

function renderMetrics() {
  const box = $('model-metrics');
  const oneline = $('metrics-oneline');
  box.textContent = '';
  oneline.textContent = '';
  const f = state.forecast;
  if (!f) {
    if (state.forecastError) box.appendChild(el('p', { class: 'muted', text: t('forecast.error') }));
    box.appendChild(el('p', { class: 'metrics-note', text: t('metrics.short') }));
    return;
  }
  const m = f.metrics || {};
  const r2 = isNum(m.r2) ? m.r2.toFixed(2) : t('na');
  if (isNum(m.maeModel) && isNum(m.maePersistence) && m.maePersistence > 0) {
    const gain = ((m.maePersistence - m.maeModel) / m.maePersistence) * 100;
    if (gain > 0) {
      const [a, b] = t('metrics.oneLine', { n: '\u0000', r2 }).split('\u0000');
      oneline.append(a, el('b', { class: 'num', text: gain.toFixed(0) }), b);
    } else oneline.textContent = t('metrics.oneLineLoses', { r2 });
  }

  const unit = () => el('small', { text: ' µg/m³' });
  const tile = (label, valueNodes, sub) => el('div', { class: 'tile' }, [
    el('dt', { text: label }),
    el('dd', { class: 'num' }, [...valueNodes, sub ? el('span', { class: 'tile-sub', text: sub }) : null]),
  ]);
  const errTile = (label, model, base) => tile(
    label,
    isNum(model) ? [model.toFixed(1), unit()] : [t('na')],
    isNum(base) ? t('metrics.vsBase', { n: base.toFixed(1) }) : null,
  );
  box.appendChild(el('dl', { class: 'tiles' }, [
    errTile(t('metrics.tile1h'), m.maeModel, m.maePersistence),
    errTile(t('metrics.tile24h'), m.mae24hModel, m.mae24hPersistence),
    tile(t('metrics.tileR2'), [r2]),
    tile(t('metrics.tileData'), [`${m.nTrain ?? '–'} / ${m.nTest ?? '–'}`]),
  ]));

  const feats = Array.isArray(f.features) ? [...f.features].filter((x) => isNum(x.weight)) : [];
  if (feats.length) {
    feats.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
    const top = feats.slice(0, 4);
    const max = Math.abs(top[0].weight) || 1;
    const ul = el('ul', { class: 'feature-list' });
    top.forEach((ft) => {
      const pct = Math.max(4, (Math.abs(ft.weight) / max) * 100);
      ul.appendChild(el('li', {}, [
        el('span', { class: 'feature-name', text: ft.name }),
        el('span', { class: 'feature-bar', 'aria-hidden': 'true' }, el('span', { style: `width:${pct.toFixed(0)}%` })),
        el('span', {
          class: 'num feature-w',
          title: isNum(ft.coef) ? `coef ${ft.coef}` : null,
          text: `${ft.direction === '-' ? '−' : ft.direction === '+' ? '+' : ''}${(ft.weight * (ft.weight <= 1 ? 100 : 1)).toFixed(0)}%`,
        }),
      ]));
    });
    box.appendChild(el('h4', { text: t('metrics.topInputs') }));
    box.appendChild(ul);
  }
  box.appendChild(el('p', { class: 'metrics-note', text: t('metrics.short') }));
}

/* ------------------------------------------------------------------ cities */

function renderCities() {
  const list = $('cities-list');
  const summary = $('cities-summary');
  const cities = (state.cities?.cities || []).filter((c) => isNum(c.aqi));
  showError('cities-error', !!state.errors.cities && !cities.length);
  if (!cities.length) {
    if (!state.errors.cities) {
      list.textContent = '';
      for (let i = 0; i < 4; i++) list.appendChild(el('li', {}, el('span', { class: 'skeleton skeleton-line', style: 'max-width:none;height:28px' })));
    } else list.textContent = '';
    summary.textContent = '';
    return;
  }
  const sorted = [...cities].sort((a, b) => b.aqi - a.aqi);
  const max = Math.max(...sorted.map((c) => c.aqi), 1);
  const lang = getLang();
  list.textContent = '';
  sorted.forEach((c, i) => {
    const cat = categoryOf(c.aqi);
    const name = lang === 'ur' ? (c.nameUr || c.name) : c.name;
    const home = c.id === 'lahore';
    const tags = [];
    if (home) tags.push(el('span', { class: 'tag tag-home', text: t('cities.you') }));
    if (sorted.length > 1 && i === 0) tags.push(el('span', { class: 'tag tag-worst', text: t('cities.worst') }));
    if (sorted.length > 1 && i === sorted.length - 1) tags.push(el('span', { class: 'tag tag-best', text: t('cities.cleanest') }));
    const bar = el('span', { class: 'city-bar', 'aria-hidden': 'true' },
      el('span', { style: `width:${Math.max(4, (c.aqi / max) * 100).toFixed(1)}%;background:${cat.color}` }));
    list.appendChild(el('li', { class: `city-row${home ? ' is-home' : ''}` }, [
      el('span', { class: 'city-rank', text: String(i + 1) }),
      el('span', { class: 'city-name' }, [name, ...tags]),
      bar,
      el('span', { class: 'city-aqi-wrap' }, [
        el('span', { class: 'city-aqi num', style: `background:${cat.color};color:${cat.textColor}`, text: String(Math.round(c.aqi)) }),
        el('span', { class: 'city-cat', text: catLabel(cat) }),
      ]),
    ]));
  });
  reveal(list);
  const lahore = sorted.find((c) => c.id === 'lahore');
  const cleanest = sorted[sorted.length - 1];
  summary.textContent = '';
  if (lahore && cleanest) {
    const msg = lahore.id === cleanest.id || cleanest.aqi <= 0
      ? t('cities.ratioBest')
      : t('cities.ratio', {
        n: (lahore.aqi / cleanest.aqi).toFixed(1),
        city: lang === 'ur' ? (cleanest.nameUr || cleanest.name) : cleanest.name,
      });
    summary.append(iconEl('bulb'), el('span', { text: msg }));
  }
}

/* --------------------------------------------------------------------- map */

function ensureMap() {
  if (mapView.isReady()) return true;
  const ok = mapView.initMap($('map'), { categoryOf, onPick: handlePick });
  if (!ok) {
    $('map').classList.add('map-unavailable');
    $('map').textContent = t('map.unavailable');
    return false;
  }
  pushMapData();
  return true;
}

function pushMapData() {
  if (!mapView.isReady()) return;
  if (state.cities?.cities) mapView.setCities(state.cities.cities);
  mapView.setFires(state.fires);
  mapView.setReports(state.reports);
}

function renderMapNote() {
  const note = $('map-note');
  if (!state.fires) { note.hidden = true; return; }
  note.hidden = false;
  if (state.fires.configured === false) note.textContent = t('map.firmsNote');
  else note.textContent = t('map.firesCount', { n: (state.fires.fires || []).length });
}

function renderLegend() {
  const ul = $('map-legend');
  ul.textContent = '';
  [25, 75, 125, 175, 250, 350].forEach((v) => {
    const c = categoryOf(v);
    ul.appendChild(el('li', {}, [el('span', { class: 'swatch', style: `background:${c.color}`, 'aria-hidden': 'true' }), catLabel(c)]));
  });
  ul.appendChild(el('li', {}, [el('span', { class: 'swatch swatch-fire', 'aria-hidden': 'true' }), t('legend.fire')]));
  ul.appendChild(el('li', {}, [el('span', { class: 'swatch swatch-report', 'aria-hidden': 'true' }), t('legend.report')]));
}

function setReportMode(on) {
  state.reportMode = on;
  if (on && !ensureMap()) { state.reportMode = false; return; }
  const btn = $('report-toggle');
  btn.setAttribute('aria-pressed', String(on));
  const label = btn.querySelector('[data-i18n]');
  label.dataset.i18n = on ? 'map.cancelReport' : 'map.report';
  label.textContent = t(label.dataset.i18n);
  $('report-locate').hidden = !on || !('geolocation' in navigator);
  $('map-hint').hidden = !on;
  mapView.setReportMode(on);
  if (!on) {
    state.picked = null;
    $('report-form').hidden = true;
  }
}

function handlePick(lat, lon) {
  state.picked = { lat, lon };
  $('report-coords').textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  $('report-form').hidden = false;
  $('report-status').textContent = '';
  $('report-type').focus({ preventScroll: true });
}

function initReportUi() {
  $('report-toggle').addEventListener('click', () => setReportMode(!state.reportMode));
  $('report-cancel').addEventListener('click', () => { setReportMode(false); $('report-toggle').focus(); });
  $('report-locate').addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        mapView.setPicked(latitude, longitude, { pan: true });
        handlePick(latitude, longitude);
      },
      () => { $('report-status').textContent = t('map.locError'); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  });
  $('report-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('report-status');
    if (!state.picked) { status.textContent = t('report.needLocation'); return; }
    const submit = $('report-submit');
    submit.disabled = true;
    submit.textContent = t('report.sending');
    try {
      const res = await api.postReport({
        type: $('report-type').value,
        lat: state.picked.lat,
        lon: state.picked.lon,
        note: $('report-note').value.trim(),
      });
      const report = res?.report || res;
      state.reports = [...state.reports, report];
      setReportMode(false);
      mapView.addReport(report);
      $('report-note').value = '';
      status.textContent = t('report.success');
      $('report-toggle').focus();
    } catch (err) {
      console.error(err);
      status.textContent = t('report.error');
    } finally {
      submit.disabled = false;
      submit.textContent = t('report.submit');
    }
  });
}

function initLazyMap() {
  const section = $('map-section');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) { io.disconnect(); ensureMap(); }
    }, { rootMargin: '300px' });
    io.observe(section);
  } else {
    ensureMap();
  }
}

/* -------------------------------------------------------------------- chat */

const QUICK = ['chat.q1', 'chat.q2', 'chat.q3', 'chat.q4'];

function renderQuickQuestions() {
  const wrap = $('quick-questions');
  wrap.textContent = '';
  QUICK.forEach((key) => {
    const b = el('button', { type: 'button', class: 'chip-btn', text: t(key) });
    b.addEventListener('click', () => sendChat(t(key)));
    wrap.appendChild(b);
  });
}

function chatBubble(role, text, { welcome = false, error = false } = {}) {
  const isUser = role === 'user';
  const who = isUser ? t('chat.you') : t('chat.bot');
  const div = el('div', { class: `msg msg-${isUser ? 'user' : 'bot'}${error ? ' msg-error' : ''} fade-in` });
  if (welcome) div.dataset.welcome = '1';
  if (!isUser) div.appendChild(iconEl('sparkle', 'avatar'));
  const body = el('div', { class: 'msg-body' }, el('span', { class: 'sr-only', text: `${who}: ` }));
  appendMultiline(body, text);
  div.appendChild(body);
  return div;
}

function renderChatWelcome() {
  const log = $('chat-log');
  const old = log.querySelector('[data-welcome]');
  const fresh = chatBubble('assistant', t('chat.welcome'), { welcome: true });
  if (old) old.replaceWith(fresh); else log.prepend(fresh);
}

function chatContext() {
  const cur = getCurrent();
  const cat = categoryOf(cur.aqi);
  return {
    city: 'Lahore',
    aqi: isNum(cur.aqi) ? Math.round(cur.aqi) : null,
    pm25: isNum(cur.pm25) ? Math.round(cur.pm25) : null,
    category: cat.en,
    aqiNote: 'aqi is the Open-Meteo US AQI (24-hour average index); PM2.5 is CAMS-modelled, not ground-station data',
    forecastSummary: (() => {
      const ex = forecastExtremes();
      if (!ex) return '';
      return `Next 24h (in-browser model, hourly AQI derived from PM2.5): worst ${fmtHour(ex.worst.time)} AQI ${Math.round(ex.worst.aqi)}, best ${fmtHour(ex.best.time)} AQI ${Math.round(ex.best.aqi)}`;
    })(),
    weather: state.weather?.current || null,
  };
}

function scrollChat() {
  const log = $('chat-log');
  log.scrollTop = log.scrollHeight;
}

async function sendChat(text) {
  const msg = String(text || '').trim();
  if (!msg || state.chatBusy) return;
  const log = $('chat-log');
  const input = $('chat-input');
  state.chatBusy = true;
  $('chat-send').disabled = true;
  input.value = '';
  autoGrow(input);
  state.chat.push({ role: 'user', content: msg });
  log.appendChild(chatBubble('user', msg));
  $('chat-typing').hidden = false;
  scrollChat();
  try {
    const res = await api.postChat({ messages: state.chat.slice(-12), lang: getLang(), context: chatContext() });
    const reply = String(res?.reply ?? '');
    state.chat.push({ role: 'assistant', content: reply });
    log.appendChild(chatBubble('assistant', reply));
  } catch (err) {
    state.chat.pop(); // keep the history consistent for the next try
    let key = 'chat.error';
    if (err?.status === 503 && err?.data?.error === 'no_key') key = 'chat.noKey';
    else if (err?.network || !navigator.onLine) key = 'chat.offline';
    const text = err?.status === 429 && err?.data?.message ? String(err.data.message) : t(key);
    log.appendChild(chatBubble('assistant', text, { error: true }));
  } finally {
    state.chatBusy = false;
    $('chat-send').disabled = false;
    $('chat-typing').hidden = true;
    scrollChat();
  }
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
}

function initChat() {
  renderQuickQuestions();
  renderChatWelcome();
  const input = $('chat-input');
  $('chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendChat(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(input.value); }
  });
  input.addEventListener('input', () => autoGrow(input));
}

/* ------------------------------------------------------------------ policy */

function renderPolicy(force = false) {
  const box = $('policy-sim');
  if (!mods.loaded) return;
  if (!mods.policy || typeof mods.policy.renderPolicySim !== 'function') {
    box.textContent = '';
    box.appendChild(el('p', { class: 'muted', text: t('policy.error') }));
    return;
  }
  const aqi = getCurrent().aqi;
  const currentAqi = isNum(aqi) ? Math.round(aqi) : null;
  // Re-render only on first load, language change, or when live AQI first arrives
  // (avoid resetting the user's slider choices on every auto-refresh).
  if (!force && state.policyRendered && !(state.policyAqi == null && currentAqi != null)) return;
  try {
    box.textContent = '';
    mods.policy.renderPolicySim(box, { currentAqi, lang: getLang() });
    state.policyRendered = true;
    state.policyAqi = currentAqi;
  } catch (e) {
    console.error('renderPolicySim failed', e);
    box.textContent = '';
    box.appendChild(el('p', { class: 'muted', text: t('policy.error') }));
  }
}

/* ------------------------------------------------------------------ footer */

function renderFooter() {
  $('ts-aq').textContent = fmtStamp(state.cities?.updatedAt);
  $('ts-weather').textContent = fmtStamp(state.weather?.updatedAt);
  $('ts-history').textContent = fmtStamp(state.history?.updatedAt);
  $('ts-fires').textContent = state.fires?.configured === false ? t('na') : fmtStamp(state.fires?.updatedAt);
}

/* -------------------------------------------------------------- data flow */

function renderAll() {
  renderHeader();
  renderHero();
  renderProfiles();
  renderAdvice();
  renderForecast();
  renderCities();
  renderMapNote();
  renderLegend();
  renderFooter();
  updateFades();
}

async function refreshAll() {
  if (state.refreshing) return;
  state.refreshing = true;
  const btn = $('refresh-btn');
  btn.classList.add('is-spinning');
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;

  // Fires (NASA FIRMS) can be slow, so they load separately and never block the rest of the page.
  api.getFires().then((value) => {
    if (value) { state.fires = value; state.errors.fires = null; }
  }).catch((err) => {
    state.errors.fires = err || new Error('failed');
    console.warn('[saaf-saans] fires failed', err);
  }).finally(() => {
    pushMapData();
    renderMapNote();
    renderFooter();
  });

  const [cities, weather, history, reports] = await Promise.allSettled([
    api.getCities(), api.getWeather('lahore'), api.getHistory('lahore'), api.getReports(),
  ]);

  const take = (key, res) => {
    if (res.status === 'fulfilled' && res.value) { state[key] = res.value; state.errors[key] = null; return true; }
    state.errors[key] = res.reason || new Error('failed');
    if (res.status === 'rejected') console.warn(`[saaf-saans] ${key} failed`, res.reason);
    return false;
  };
  take('cities', cities);
  take('weather', weather);
  const historyOk = take('history', history);
  if (reports.status === 'fulfilled' && Array.isArray(reports.value?.reports)) {
    state.reports = reports.value.reports;
    state.errors.reports = null;
  }

  if (historyOk) runForecast();

  const anyOk = [cities, weather, history].some((r) => r.status === 'fulfilled');
  if (anyOk) state.lastUpdated = new Date();

  renderAll();
  pushMapData();
  renderPolicy();

  state.refreshing = false;
  btn.classList.remove('is-spinning');
  btn.removeAttribute('aria-busy');
  btn.disabled = false;
  if (anyOk) announce(t('header.updatedAnnounce', { time: $('last-updated').textContent }));
}

function runForecast() {
  state.forecastError = false;
  if (!mods.forecast || typeof mods.forecast.trainAndForecast !== 'function') { state.forecast = null; return; }
  try {
    state.forecast = mods.forecast.trainAndForecast(state.history);
  } catch (e) {
    console.error('trainAndForecast failed', e);
    state.forecast = null;
    state.forecastError = true;
  }
}

async function loadModules() {
  const [aqi, forecast, advisor, policy] = await Promise.allSettled([
    import('./aqi.js'), import('./forecast.js'), import('./advisor.js'), import('./policy.js'),
  ]);
  const pick = (r, name) => {
    if (r.status === 'fulfilled') return r.value;
    console.error(`[saaf-saans] could not load ${name}`, r.reason);
    return null;
  };
  mods.aqi = pick(aqi, 'aqi.js');
  mods.forecast = pick(forecast, 'forecast.js');
  mods.advisor = pick(advisor, 'advisor.js');
  mods.policy = pick(policy, 'policy.js');
  mods.loaded = true;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW registration failed', e));
  });
}

/* -------------------------------------------------------------------- boot */

async function main() {
  initI18n();
  hydrateIcons();
  initTheme();
  renderHeader();
  initNav();
  initChat();
  initReportUi();
  registerServiceWorker();
  renderPollutants(getCurrent(), false);
  renderWeather();
  renderHourStrip();

  $('lang-toggle').addEventListener('click', () => setLang(getLang() === 'ur' ? 'en' : 'ur'));
  $('refresh-btn').addEventListener('click', () => {
    announce(t('header.refreshing'));
    refreshAll();
  });
  onLangChange(() => {
    renderAll();
    renderQuickQuestions();
    renderChatWelcome();
    // keep report toggle label consistent with mode
    const label = $('report-toggle').querySelector('[data-i18n]');
    label.dataset.i18n = state.reportMode ? 'map.cancelReport' : 'map.report';
    label.textContent = t(label.dataset.i18n);
    mapView.refreshLabels();
    renderPolicy(true);
  });
  window.addEventListener('online', () => { renderOfflineBanner(); refreshAll(); });
  window.addEventListener('offline', renderOfflineBanner);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.lastUpdated && Date.now() - state.lastUpdated.getTime() > REFRESH_MS) {
      refreshAll();
    }
  });

  await loadModules();
  renderProfiles();
  renderLegend();
  initLazyMap();
  await refreshAll();
  setInterval(refreshAll, REFRESH_MS);
}

main().catch((e) => console.error('[saaf-saans] boot failed', e));
