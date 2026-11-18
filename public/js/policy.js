// policy.js — "Policy & Enforcement impact simulator".
// A transparent what-if calculator (not a dispersion model): reduces the
// human-made share of PM2.5 according to source sliders and shows the effect on
// AQI, unhealthy hours and an illustrative health/cost proxy.
// No DOM access at import time: importable in Node.

import { aqiCategory, aqiToPm25, pm25ToAqi } from './aqi.js';

// Indicative source shares of the human-made PM2.5 in Lahore (for illustration).
export const SOURCES = [
  { id: 'vehicles', share: 0.40, en: 'Vehicles', ur: 'گاڑیاں' },
  { id: 'industry', share: 0.25, en: 'Industry & brick kilns', ur: 'صنعت اور اینٹوں کے بھٹے' },
  { id: 'crop', share: 0.20, en: 'Crop residue burning', ur: 'فصلوں کی باقیات جلانا' },
  { id: 'dust', share: 0.15, en: 'Construction dust & waste burning', ur: 'تعمیراتی گرد اور کچرا جلانا' },
];

export const PRESETS = [
  { id: 'stubble', en: 'Ban stubble burning', ur: 'پرالی جلانے پر پابندی', values: { vehicles: 0, industry: 0, crop: 80, dust: 0 } },
  { id: 'kilns', en: 'Zig-zag kiln conversion', ur: 'زِگ زیگ بھٹوں پر منتقلی', values: { vehicles: 0, industry: 35, crop: 0, dust: 0 } },
  { id: 'oddeven', en: 'Odd-even traffic', ur: 'جفت-طاق ٹریفک اسکیم', values: { vehicles: 20, industry: 0, crop: 0, dust: 0 } },
  { id: 'all', en: 'All measures', ur: 'تمام اقدامات', values: { vehicles: 40, industry: 50, crop: 80, dust: 50 } },
];

// Transparent assumptions (shown to the user).
export const ASSUMPTIONS = {
  background: 0.15, // share of PM2.5 that local policy cannot reduce (regional/natural)
  population: 13_000_000, // Lahore, approx.
  pkrPerPersonPer10: 15, // PKR per person per day per 10 µg/m³ above WHO guideline (illustrative)
  whoGuideline: 5, // µg/m³ annual WHO 2021 guideline
  riskPer10: 0.08, // ~8% higher long-term mortality risk per +10 µg/m³ (approx., literature range ~6–8%)
  seasonDays: 92, // Nov–Jan smog season
  seasonGsd: 2.0, // season hourly PM2.5 ~ lognormal around today's level, geometric SD 2
  unhealthyPm: 55.5, // µg/m³ (AQI > 150)
};

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 erf approximation). */
function normCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Pure model: given currentAqi and reductions {id: 0..100}, compute outputs. */
export function simulate(currentAqi, reductions) {
  const A = ASSUMPTIONS;
  const pm0 = aqiToPm25(currentAqi) ?? 0;
  const cut = SOURCES.reduce((s, src) => s + src.share * (Math.min(100, Math.max(0, Number(reductions[src.id]) || 0)) / 100), 0);
  const pm1 = pm0 * A.background + pm0 * (1 - A.background) * (1 - cut);
  const aqi0 = pm25ToAqi(pm0);
  const aqi1 = pm25ToAqi(pm1);
  const seasonHours = A.seasonDays * 24;
  const unhealthy = (pm) => (pm > 0 ? Math.round(seasonHours * (1 - normCdf((Math.log(A.unhealthyPm) - Math.log(pm)) / Math.log(A.seasonGsd)))) : 0);
  const excess = (pm) => Math.max(0, pm - A.whoGuideline);
  const cost = (pm) => A.population * A.pkrPerPersonPer10 * (excess(pm) / 10);
  return {
    pm0, pm1, aqi0, aqi1,
    cutShare: cut * (1 - A.background),
    unhealthy0: unhealthy(pm0),
    unhealthy1: unhealthy(pm1),
    risk0: (excess(pm0) / 10) * A.riskPer10,
    risk1: (excess(pm1) / 10) * A.riskPer10,
    cost0: cost(pm0),
    cost1: cost(pm1),
  };
}

const STR = {
  title: { en: 'Policy & enforcement impact simulator', ur: 'پالیسی اور نفاذ کے اثرات کا سمیلیٹر' },
  intro: { en: 'Move the sliders to see how cutting each pollution source could change today’s air.', ur: 'سلائیڈرز ہلا کر دیکھیں کہ ہر آلودگی کے ذریعے میں کمی سے آج کی ہوا کیسے بدل سکتی ہے۔' },
  disclaimer: { en: 'Indicative shares for illustration, based on public estimates (e.g. Punjab EPA / Urban Unit reports); verify before policy use.', ur: 'یہ حصے صرف وضاحت کے لیے اندازاً ہیں، عوامی تخمینوں (مثلاً پنجاب EPA / اربن یونٹ رپورٹس) پر مبنی؛ پالیسی میں استعمال سے پہلے تصدیق کریں۔' },
  presets: { en: 'Presets', ur: 'تیار منظرنامے' },
  reset: { en: 'Reset', ur: 'ری سیٹ' },
  share: { en: 'share', ur: 'حصہ' },
  reduction: { en: 'reduction', ur: 'کمی' },
  now: { en: 'Now', ur: 'ابھی' },
  projected: { en: 'Projected', ur: 'متوقع' },
  pm: { en: 'PM2.5', ur: 'PM2.5' },
  hours: { en: 'Unhealthy hours per smog season (AQI > 150)', ur: 'اسموگ کے موسم میں مضرِ صحت گھنٹے (AQI > 150)' },
  risk: { en: 'Long-term excess health risk (proxy)', ur: 'طویل مدتی اضافی صحت خطرہ (اندازہ)' },
  cost: { en: 'Estimated cost of smog to Lahore, per day', ur: 'لاہور پر اسموگ کی تخمینی لاگت، فی دن' },
  saved: { en: 'saved', ur: 'بچت' },
  perSeason: { en: 'per season', ur: 'فی موسم' },
  noData: { en: 'Current AQI not available: showing an example at AQI 250.', ur: 'موجودہ AQI دستیاب نہیں: AQI 250 پر مثال دکھائی جا رہی ہے۔' },
  assumptions: { en: 'Assumptions & formulas', ur: 'مفروضے اور فارمولے' },
  sources: { en: 'Cut each source', ur: 'ہر ذریعے میں کمی' },
  impact: { en: 'Projected impact', ur: 'متوقع اثر' },
  ofHuman: { en: 'of human-made PM2.5', ur: 'انسانی PM2.5 کا حصہ' },
  hoursFewer: { en: 'fewer hours', ur: 'کم گھنٹے' },
  points: { en: 'percentage points', ur: 'فیصد پوائنٹس' },
};

const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
function pkr(n, ur) {
  if (n >= 1e9) return `PKR ${fmt(n / 1e9, 2)} ${ur ? 'ارب' : 'billion'}`;
  if (n >= 1e6) return `PKR ${fmt(n / 1e6, 1)} ${ur ? 'ملین' : 'million'}`;
  return `PKR ${fmt(n)}`;
}

// Scoped styles: only theme variables from the main stylesheet (with fallbacks),
// so the panel follows light/dark automatically. AQI category colours are data colours.
const CSS = `
.ps-root{--ps-surface:var(--surface,#fff);--ps-surface-2:var(--surface-2,#f0f3f8);--ps-text:var(--text,#111827);--ps-muted:var(--muted,#5b6474);--ps-border:var(--border,#e3e7ee);--ps-accent:var(--accent,#1d4ed8);--ps-accent-strong:var(--accent-strong,#1e40af);--ps-accent-soft:var(--accent-soft,#e0e8ff);--ps-on-accent:var(--on-accent,#fff);--ps-ok:var(--ok,#15803d);--ps-no:var(--no,#b91c1c);--ps-r:var(--radius,16px);--ps-rs:var(--radius-sm,10px);
  container-type:inline-size;font-family:var(--font,system-ui,sans-serif);color:var(--ps-text);background:var(--ps-surface);border:1px solid var(--ps-border);border-radius:var(--ps-r);box-shadow:var(--shadow,none);padding:clamp(14px,3.5vw,24px);max-width:100%;min-width:0;box-sizing:border-box;overflow-wrap:break-word}
.ps-root[lang=ur]{font-family:var(--font-ur,serif)}
.ps-root *,.ps-root *::before,.ps-root *::after{box-sizing:border-box}
.ps-num{font-family:var(--font,system-ui,sans-serif);direction:ltr;unicode-bidi:isolate;font-variant-numeric:tabular-nums}
.ps-intro{margin:0 0 12px;color:var(--ps-muted);font-size:.95rem}
.ps-note{font-size:.8rem;color:var(--ps-muted);margin:0 0 10px;padding:8px 12px;border-inline-start:3px solid var(--ps-accent);background:var(--ps-surface-2);border-radius:var(--ps-rs)}
.ps-kicker{display:block;margin:0 0 8px;font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ps-muted)}
.ps-root[lang=ur] .ps-kicker{letter-spacing:0;text-transform:none;font-size:.85rem}
.ps-presets{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 20px;align-items:center}
.ps-chip{font:inherit;font-size:.88rem;font-weight:500;min-height:44px;padding:8px 16px;border-radius:999px;border:1px solid var(--ps-border);background:var(--ps-surface);color:var(--ps-text);cursor:pointer;line-height:1.2;max-width:100%}
.ps-chip:hover{border-color:var(--ps-accent);background:var(--ps-accent-soft)}
.ps-chip[aria-pressed=true]{background:var(--ps-accent);border-color:var(--ps-accent);color:var(--ps-on-accent)}
.ps-chip-reset{border-color:transparent;background:transparent;color:var(--ps-muted);text-decoration:underline;text-underline-offset:3px}
.ps-chip-reset:hover{background:var(--ps-surface-2);border-color:transparent;color:var(--ps-text)}
.ps-root button:focus-visible,.ps-root summary:focus-visible{outline:3px solid var(--focus,var(--ps-accent));outline-offset:2px}
.ps-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:20px}
@container (min-width:640px){.ps-grid{grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:28px}}
.ps-sliders{display:grid;gap:14px;align-content:start}
.ps-slider{padding:12px 14px 6px;border:1px solid var(--ps-border);border-radius:var(--ps-rs);background:var(--ps-surface)}
.ps-slider-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.ps-slider label{font-weight:600;font-size:.92rem;line-height:1.35}
.ps-share{display:block;font-weight:400;font-size:.78rem;color:var(--ps-muted);margin-top:2px}
.ps-val{flex:none;font-weight:700;font-size:.95rem;color:var(--ps-accent-strong);background:var(--ps-accent-soft);padding:2px 10px;border-radius:999px;min-width:3.4em;text-align:center}
.ps-val[data-zero]{color:var(--ps-muted);background:var(--ps-surface-2)}
.ps-range{--ps-fill:0%;-webkit-appearance:none;appearance:none;display:block;width:100%;height:44px;margin:0;background:transparent;cursor:pointer;direction:inherit}
.ps-range::-webkit-slider-runnable-track{height:8px;border-radius:999px;background:linear-gradient(to right,var(--ps-accent) 0 var(--ps-fill),var(--ps-surface-2) var(--ps-fill) 100%);box-shadow:inset 0 0 0 1px var(--ps-border)}
.ps-range::-moz-range-track{height:8px;border-radius:999px;background:var(--ps-surface-2);box-shadow:inset 0 0 0 1px var(--ps-border)}
.ps-range::-moz-range-progress{height:8px;border-radius:999px;background:var(--ps-accent)}
.ps-root[dir=rtl] .ps-range::-webkit-slider-runnable-track{background:linear-gradient(to left,var(--ps-accent) 0 var(--ps-fill),var(--ps-surface-2) var(--ps-fill) 100%)}
.ps-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:24px;height:24px;margin-top:-8px;border-radius:50%;background:var(--ps-surface);border:3px solid var(--ps-accent);box-shadow:0 1px 4px rgba(0,0,0,.25)}
.ps-range::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:var(--ps-surface);border:3px solid var(--ps-accent);box-shadow:0 1px 4px rgba(0,0,0,.25)}
.ps-range:focus{outline:none}
.ps-range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 4px var(--ps-accent-soft),0 0 0 6px var(--ps-accent)}
.ps-range:focus-visible::-moz-range-thumb{box-shadow:0 0 0 4px var(--ps-accent-soft),0 0 0 6px var(--ps-accent)}
.ps-out{display:grid;gap:14px;align-content:start;min-width:0}
.ps-compare{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:10px;align-items:stretch}
.ps-card{--ps-cat:#9e9e9e;position:relative;min-width:0;padding:14px 14px 12px;border-radius:var(--ps-rs);background:var(--ps-surface-2);border:1px solid var(--ps-border);border-top:5px solid var(--ps-cat)}
.ps-card-label{display:block;font-size:.78rem;font-weight:600;color:var(--ps-muted);text-transform:uppercase;letter-spacing:.06em}
.ps-root[lang=ur] .ps-card-label{text-transform:none;letter-spacing:0;font-size:.85rem}
.ps-big{display:block;font-size:clamp(2rem,9cqi,2.9rem);font-weight:800;line-height:1.1;margin:4px 0 6px;color:var(--ps-text);color:color-mix(in oklab,var(--ps-cat) 58%,var(--ps-text))}
.ps-pill{display:inline-block;max-width:100%;overflow-wrap:normal;padding:3px 10px;border-radius:999px;font-size:.75rem;font-weight:600;line-height:1.4}
.ps-pm{display:block;margin-top:8px;font-size:.78rem;color:var(--ps-muted)}
.ps-delta{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:56px;text-align:center}
.ps-delta svg{width:26px;height:26px;color:var(--ps-muted)}
.ps-root[dir=rtl] .ps-delta svg{transform:scaleX(-1)}
.ps-delta b{font-size:.85rem;white-space:nowrap}
.ps-up{color:var(--ps-ok)}
.ps-same{color:var(--ps-muted)}
.ps-stats{display:grid;gap:10px}
@container (max-width:420px){.ps-compare{grid-template-columns:minmax(0,1fr)}.ps-delta{flex-direction:row;padding:2px 0}.ps-delta svg{transform:rotate(90deg)}.ps-root[dir=rtl] .ps-delta svg{transform:rotate(90deg)}}
.ps-stat{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;align-items:start;padding:12px 14px;border:1px solid var(--ps-border);border-radius:var(--ps-rs);background:var(--ps-surface)}
.ps-icon{grid-row:span 3;display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:var(--ps-accent-soft);color:var(--ps-accent-strong)}
.ps-icon svg{width:22px;height:22px}
.ps-stat-label{font-size:.82rem;color:var(--ps-muted);line-height:1.35}
.ps-stat-vals{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;font-size:.95rem}
.ps-before{color:var(--ps-muted)}
.ps-after{font-size:1.2rem;font-weight:700}
.ps-arrow-i{color:var(--ps-muted)}
.ps-stat-delta{font-size:.82rem;font-weight:600}
.ps-details{margin-top:20px;border:1px solid var(--ps-border);border-radius:var(--ps-rs);background:var(--ps-surface-2);font-size:.86rem}
.ps-details summary{cursor:pointer;min-height:44px;display:flex;align-items:center;gap:8px;padding:8px 14px;font-weight:600;list-style:none;border-radius:var(--ps-rs)}
.ps-details summary::-webkit-details-marker{display:none}
.ps-details summary::before{content:"";width:8px;height:8px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg);flex:none}
.ps-root[dir=rtl] .ps-details summary::before{transform:rotate(135deg)}
.ps-details[open] summary::before,.ps-root[dir=rtl] .ps-details[open] summary::before{transform:rotate(45deg)}
.ps-details ul{margin:0;padding:0 14px 14px;padding-inline-start:32px;color:var(--ps-muted);display:grid;gap:6px}
@media (prefers-reduced-motion:no-preference){
  .ps-chip,.ps-val,.ps-details summary::before{transition:background-color .15s ease,border-color .15s ease,color .15s ease,transform .15s ease}
  .ps-card{transition:border-color .25s ease}
  .ps-big{transition:color .25s ease}
}
`;

const ICONS = {
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/><path d="M3.5 12h4l2-3 3 6 2-3h6"/></svg>',
  coins: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M3 12v5c0 1.7 2.7 3 6 3 1.4 0 2.6-.2 3.6-.6"/><circle cx="17.5" cy="16.5" r="4"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

let instance = 0;

/** Render (or fully re-render) the simulator into containerEl. */
export function renderPolicySim(containerEl, { currentAqi, lang = 'en' } = {}) {
  if (!containerEl) return;
  const ur = lang === 'ur';
  const L = (k) => STR[k][ur ? 'ur' : 'en'];
  const hasAqi = Number.isFinite(Number(currentAqi)) && currentAqi !== null;
  const baseAqi = hasAqi ? Number(currentAqi) : 250;
  const uid = `ps${++instance}`;
  const state = Object.fromEntries(SOURCES.map((s) => [s.id, 0]));
  const N = (v) => `<span class="ps-num">${v}</span>`;

  const sliders = SOURCES.map((s) => `
    <div class="ps-slider">
      <div class="ps-slider-head">
        <label for="${uid}-${s.id}">${ur ? s.ur : s.en}
          <span class="ps-share">${N(`${Math.round(s.share * 100)}%`)} ${L('ofHuman')}</span></label>
        <output class="ps-val ps-num" id="${uid}-${s.id}-v" for="${uid}-${s.id}" data-zero>0%</output>
      </div>
      <input class="ps-range" type="range" id="${uid}-${s.id}" data-src="${s.id}" min="0" max="100" step="5" value="0"
        aria-describedby="${uid}-${s.id}-v" aria-valuetext="0% ${L('reduction')}">
    </div>`).join('');

  const presets = PRESETS.map((p) => `<button type="button" class="ps-chip" data-preset="${p.id}" aria-pressed="false">${ur ? p.ur : p.en}</button>`).join('');

  const A = ASSUMPTIONS;
  const assumptions = ur
    ? `<ul>
        <li>موجودہ AQI کو EPA کے بریک پوائنٹس الٹ کر PM2.5 میں بدلا جاتا ہے۔</li>
        <li>PM2.5 کا ${A.background * 100}% پس منظر (علاقائی/قدرتی) ہے جو مقامی پالیسی سے کم نہیں ہوتا۔ باقی حصہ ذرائع کے حصوں کے مطابق کم ہوتا ہے: نیا PM2.5 = PM × ${A.background} + PM × ${1 - A.background} × (1 − Σ حصہ × کمی)۔</li>
        <li>مضرِ صحت گھنٹے: فرض کیا گیا ہے کہ ${A.seasonDays} دن کے موسم میں گھنٹہ وار PM2.5 آج کی سطح کے گرد لاگ نارمل انداز میں بدلتا ہے (جیومیٹرک SD ${A.seasonGsd})؛ ${A.unhealthyPm} µg/m³ سے اوپر والے گھنٹے گنے جاتے ہیں۔</li>
        <li>صحت خطرہ: WHO رہنما سطح (${A.whoGuideline} µg/m³) سے ہر 10 µg/m³ اضافے پر تقریباً ${A.riskPer10 * 100}% زیادہ طویل مدتی خطرہ (سادہ خطی اندازہ)۔</li>
        <li>لاگت: ${fmt(A.population)} آبادی × PKR ${A.pkrPerPersonPer10} فی فرد فی دن، WHO سطح سے ہر 10 µg/m³ اضافے پر (علاج، کام کا نقصان؛ وضاحتی مفروضہ)۔</li>
        <li>یہ ایک سادہ وضاحتی ماڈل ہے، فضائی پھیلاؤ کا ماڈل نہیں۔</li>
      </ul>`
    : `<ul>
        <li>Current AQI is converted to PM2.5 by inverting the US EPA (2024) breakpoints.</li>
        <li>${A.background * 100}% of PM2.5 is treated as background (regional/natural) that local policy can’t reduce. The rest is cut in proportion to source shares: new PM2.5 = PM × ${A.background} + PM × ${1 - A.background} × (1 − Σ share × reduction).</li>
        <li>Unhealthy hours: assumes hourly PM2.5 over a ${A.seasonDays}-day season varies log-normally around today’s level (geometric SD ${A.seasonGsd}); counts hours above ${A.unhealthyPm} µg/m³ (AQI &gt; 150).</li>
        <li>Health proxy: ~${A.riskPer10 * 100}% higher long-term mortality risk per 10 µg/m³ above the WHO guideline (${A.whoGuideline} µg/m³), linear approximation.</li>
        <li>Cost: ${fmt(A.population)} people × PKR ${A.pkrPerPersonPer10} per person per day for every 10 µg/m³ above the WHO guideline (medical costs and lost work; illustrative assumption).</li>
        <li>This is a simple illustrative calculator, not an atmospheric dispersion model.</li>
      </ul>`;

  containerEl.innerHTML = `
    <style>${CSS}</style>
    <section class="ps-root" dir="${ur ? 'rtl' : 'ltr'}" lang="${ur ? 'ur' : 'en'}" aria-label="${L('title')}">
      <p class="ps-intro">${L('intro')}</p>
      ${hasAqi ? '' : `<p class="ps-note">${L('noData')}</p>`}
      <p class="ps-note">${L('disclaimer')}</p>
      <div class="ps-presets" role="group" aria-labelledby="${uid}-pl">
        <span class="ps-kicker" id="${uid}-pl" style="width:100%;margin:0">${L('presets')}</span>${presets}
        <button type="button" class="ps-chip ps-chip-reset" data-preset="reset">${L('reset')}</button>
      </div>
      <div class="ps-grid">
        <div class="ps-sliders" role="group" aria-labelledby="${uid}-sl">
          <span class="ps-kicker" id="${uid}-sl">${L('sources')}</span>
          ${sliders}
        </div>
        <div>
          <span class="ps-kicker">${L('impact')}</span>
          <div class="ps-out" id="${uid}-out" aria-live="polite" aria-atomic="true"></div>
        </div>
      </div>
      <details class="ps-details"><summary>${L('assumptions')}</summary>${assumptions}</details>
    </section>`;

  const root = containerEl.querySelector('.ps-root');
  const out = root.querySelector(`#${uid}-out`);

  const card = (label, aqi, cat, pm) => `
    <div class="ps-card" style="--ps-cat:${cat.color}">
      <span class="ps-card-label">${label}</span>
      <b class="ps-big ps-num">${aqi}</b>
      <span class="ps-pill" style="background:${cat.color};color:${cat.textColor}">${ur ? cat.ur : cat.en}</span>
      <span class="ps-pm">${L('pm')} ${N(`${fmt(pm, 1)} µg/m³`)}</span>
    </div>`;

  const stat = (icon, label, before, after, delta) => `
    <div class="ps-stat">
      <span class="ps-icon">${ICONS[icon]}</span>
      <span class="ps-stat-label">${label}</span>
      <span class="ps-stat-vals"><span class="ps-before">${N(before)}</span><span class="ps-arrow-i" aria-hidden="true">${ur ? '←' : '→'}</span><b class="ps-after">${N(after)}</b></span>
      ${delta ? `<span class="ps-stat-delta ps-up">${delta}</span>` : ''}
    </div>`;

  const update = () => {
    const r = simulate(baseAqi, state);
    const c0 = aqiCategory(r.aqi0);
    const c1 = aqiCategory(r.aqi1);
    const pct = (v) => `+${fmt(v * 100)}%`;
    const dAqi = r.aqi0 - r.aqi1;
    const dRisk = r.risk0 - r.risk1;
    out.innerHTML = `
      <div class="ps-compare">
        ${card(L('now'), r.aqi0, c0, r.pm0)}
        <div class="ps-delta ${dAqi > 0 ? 'ps-up' : 'ps-same'}">${ICONS.arrow}<b>${dAqi > 0 ? N(`−${dAqi} AQI`) : N('±0')}</b></div>
        ${card(L('projected'), r.aqi1, c1, r.pm1)}
      </div>
      <div class="ps-stats">
        ${stat('clock', L('hours'), fmt(r.unhealthy0), fmt(r.unhealthy1),
          r.unhealthy0 > r.unhealthy1 ? `${N(`−${fmt(r.unhealthy0 - r.unhealthy1)}`)} ${L('hoursFewer')}` : '')}
        ${stat('heart', L('risk'), pct(r.risk0), pct(r.risk1),
          dRisk > 0.0005 ? `${N(`−${fmt(dRisk * 100)}`)} ${L('points')}` : '')}
        ${stat('coins', L('cost'), pkr(r.cost0, ur), pkr(r.cost1, ur),
          r.cost0 > r.cost1 ? `${N(pkr(r.cost0 - r.cost1, ur))} ${L('saved')} (${N(pkr((r.cost0 - r.cost1) * A.seasonDays, ur))} ${L('perSeason')})` : '')}
      </div>`;
  };

  const setSlider = (id, v) => {
    state[id] = v;
    const input = root.querySelector(`#${uid}-${id}`);
    const o = root.querySelector(`#${uid}-${id}-v`);
    if (input) {
      input.value = String(v);
      input.setAttribute('aria-valuetext', `${v}% ${L('reduction')}`);
      input.style.setProperty('--ps-fill', `${v}%`);
    }
    if (o) {
      o.textContent = `${v}%`;
      if (v > 0) o.removeAttribute('data-zero'); else o.setAttribute('data-zero', '');
    }
  };

  // Highlight the preset chip whose values match the current sliders.
  const syncPresets = () => {
    for (const btn of root.querySelectorAll('.ps-chip[aria-pressed]')) {
      const p = PRESETS.find((x) => x.id === btn.dataset.preset);
      const on = !!p && SOURCES.every((s) => state[s.id] === p.values[s.id]);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  };

  root.addEventListener('input', (e) => {
    const src = e.target && e.target.dataset ? e.target.dataset.src : null;
    if (!src) return;
    setSlider(src, Number(e.target.value) || 0);
    syncPresets();
    update();
  });
  root.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-preset]') : null;
    if (!btn) return;
    const p = PRESETS.find((x) => x.id === btn.dataset.preset);
    for (const s of SOURCES) setSlider(s.id, p ? p.values[s.id] : 0);
    syncPresets();
    update();
  });

  update();
}
