// aqi.js — US EPA AQI helpers (PM2.5 breakpoints revised by EPA in Feb 2024).
// Pure functions, no DOM access: safe to import in the browser and in Node.

const CATEGORIES = [
  { key: 'good', max: 50, color: '#00e400', textColor: '#0b2e0b', en: 'Good', ur: 'اچھی' },
  { key: 'moderate', max: 100, color: '#ffff00', textColor: '#3a3a00', en: 'Moderate', ur: 'معتدل' },
  { key: 'usg', max: 150, color: '#ff7e00', textColor: '#2b1400', en: 'Unhealthy for Sensitive Groups', ur: 'حساس افراد کے لیے مضر' },
  { key: 'unhealthy', max: 200, color: '#ff0000', textColor: '#ffffff', en: 'Unhealthy', ur: 'مضرِ صحت' },
  { key: 'very_unhealthy', max: 300, color: '#8f3f97', textColor: '#ffffff', en: 'Very Unhealthy', ur: 'انتہائی مضرِ صحت' },
  { key: 'hazardous', max: Infinity, color: '#7e0023', textColor: '#ffffff', en: 'Hazardous', ur: 'خطرناک' },
];

const UNKNOWN = { key: 'unknown', color: '#9e9e9e', textColor: '#111111', en: 'Unknown', ur: 'نامعلوم' };

/** Category for a US AQI value. Null/undefined/NaN → neutral "unknown". */
export function aqiCategory(aqi) {
  if (aqi === null || aqi === undefined || !Number.isFinite(Number(aqi))) return { ...UNKNOWN };
  const v = Math.round(Number(aqi));
  const c = CATEGORIES.find((cat) => v <= cat.max) || CATEGORIES[CATEGORIES.length - 1];
  const { max, ...rest } = c; // eslint-disable-line no-unused-vars
  return { ...rest };
}

// [C_lo, C_hi, I_lo, I_hi] — EPA 2024 PM2.5 (24h) breakpoints, µg/m³.
const PM25_BREAKPOINTS = [
  [0.0, 9.0, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 325.4, 301, 500],
];

/** PM2.5 (µg/m³) → integer US AQI, capped at 500. Null/invalid → null. */
export function pm25ToAqi(pm25) {
  if (pm25 === null || pm25 === undefined || !Number.isFinite(Number(pm25))) return null;
  // EPA: truncate concentration to one decimal place.
  const c = Math.max(0, Math.floor(Number(pm25) * 10 + 1e-9) / 10);
  if (c > 325.4) return 500;
  for (const [cLo, cHi, iLo, iHi] of PM25_BREAKPOINTS) {
    if (c <= cHi) {
      return Math.min(500, Math.round(((iHi - iLo) / (cHi - cLo)) * (c - cLo) + iLo));
    }
  }
  return 500;
}

/** Inverse of pm25ToAqi: US AQI → approximate PM2.5 (µg/m³). Null/invalid → null. */
export function aqiToPm25(aqi) {
  if (aqi === null || aqi === undefined || !Number.isFinite(Number(aqi))) return null;
  const a = Math.max(0, Math.min(500, Number(aqi)));
  for (const [cLo, cHi, iLo, iHi] of PM25_BREAKPOINTS) {
    if (a <= iHi) {
      const lo = Math.max(iLo, Math.min(a, iHi));
      return ((cHi - cLo) / (iHi - iLo)) * (lo - iLo) + cLo;
    }
  }
  return 325.4;
}
