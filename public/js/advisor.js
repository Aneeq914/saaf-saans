// advisor.js — rule-based, profile-aware recommendation engine.
// Inputs: live AQI + the ML forecast (forecast.js) + current weather.
// Output: bilingual (English / Urdu) practical guidance. General guidance only —
// never a substitute for medical advice. No DOM access: importable in Node.

import { aqiCategory, pm25ToAqi } from './aqi.js';

export const PROFILES = [
  { id: 'citizen', icon: '🧑', en: 'General citizen', ur: 'عام شہری' },
  { id: 'parent', icon: '👨‍👩‍👧', en: 'Parent / children', ur: 'والدین / بچے' },
  { id: 'commuter', icon: '🚗', en: 'Commuter', ur: 'روزانہ سفر کرنے والے' },
  { id: 'rider', icon: '🛵', en: 'Delivery rider', ur: 'ڈیلیوری رائیڈر' },
  { id: 'asthma', icon: '🫁', en: 'Asthma / heart patient', ur: 'دمہ / دل کے مریض' },
  { id: 'elderly', icon: '👵', en: 'Elderly', ur: 'بزرگ' },
  { id: 'school', icon: '🏫', en: 'School / office admin', ur: 'اسکول / دفتر انتظامیہ' },
  { id: 'clinic', icon: '🩺', en: 'Healthcare worker', ur: 'طبی عملہ' },
  { id: 'farmer', icon: '🌾', en: 'Farmer', ur: 'کسان' },
  { id: 'business', icon: '🏪', en: 'Business owner', ur: 'کاروباری مالک' },
];

const SENSITIVE = new Set(['asthma', 'elderly', 'parent']);
const LEVELS = ['low', 'moderate', 'high', 'very_high', 'severe'];
const LEVEL_LABEL = {
  low: { en: 'Low risk', ur: 'کم خطرہ' },
  moderate: { en: 'Moderate risk', ur: 'درمیانہ خطرہ' },
  high: { en: 'High risk', ur: 'زیادہ خطرہ' },
  very_high: { en: 'Very high risk', ur: 'بہت زیادہ خطرہ' },
  severe: { en: 'Severe risk', ur: 'شدید خطرہ' },
};

const DISCLAIMER = {
  en: 'General guidance, not medical advice. If you have breathing difficulty or chest pain, seek medical help (Rescue 1122 in emergencies).',
  ur: 'یہ عمومی رہنمائی ہے، طبی مشورہ نہیں۔ سانس لینے میں دشواری یا سینے میں درد ہو تو فوراً ڈاکٹر سے رجوع کریں (ہنگامی صورت میں ریسکیو 1122)۔',
};

const isNum = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
const hhmm = (t) => String(t).slice(11, 16);
const hourOf = (t) => parseInt(String(t).slice(11, 13), 10);

/** Risk level index 0..4. Sensitive groups get stricter (lower) thresholds. */
function levelIndex(aqi, profile) {
  if (!isNum(aqi)) return 1;
  const th = SENSITIVE.has(profile) ? [50, 100, 150, 200] : [100, 150, 200, 300];
  let i = 0;
  while (i < th.length && aqi > th[i]) i++;
  return i;
}

/** Best (lowest mean forecast AQI) non-overlapping 2-hour windows, 06:00–22:00. */
function findBestWindows(predictions, n = 3) {
  const cands = [];
  for (let i = 0; i + 1 < predictions.length; i++) {
    const a = predictions[i];
    const b = predictions[i + 1];
    if (!isNum(a.aqi) || !isNum(b.aqi)) continue;
    const h = hourOf(a.time);
    if (h < 6 || h > 20) continue; // window must end by 22:00
    cands.push({ i, avg: (a.aqi + b.aqi) / 2 });
  }
  cands.sort((x, y) => x.avg - y.avg || x.i - y.i);
  const used = new Set();
  const out = [];
  for (const c of cands) {
    if (used.has(c.i) || used.has(c.i + 1)) continue;
    used.add(c.i).add(c.i + 1);
    const start = predictions[c.i].time;
    const endH = (hourOf(start) + 2) % 24;
    out.push({ start: hhmm(start), end: `${String(endH).padStart(2, '0')}:00`, date: String(start).slice(0, 10), avgAqi: Math.round(c.avg) });
    if (out.length >= n) break;
  }
  return out.sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
}

function maskAdvice(aqi, sensitive, T) {
  if (!isNum(aqi) || aqi <= 100) {
    if (sensitive && isNum(aqi) && aqi > 50) {
      return { type: 'optional', text: T('A mask is optional; carry an N95/KN95 in case air worsens.', 'ماسک اختیاری ہے؛ ہوا خراب ہونے کی صورت کے لیے N95/KN95 ساتھ رکھیں۔') };
    }
    return { type: 'none', text: T('No mask needed for air quality right now.', 'اس وقت فضائی معیار کے لحاظ سے ماسک کی ضرورت نہیں۔') };
  }
  if (aqi <= 150 && !sensitive) {
    return { type: 'recommended', text: T('Wear an N95/KN95 for longer time outdoors. Cloth and surgical masks do not filter fine smog particles well.', 'باہر زیادہ دیر رہنا ہو تو N95/KN95 پہنیں۔ کپڑے یا سرجیکل ماسک باریک ذرات کو ٹھیک سے نہیں روکتے۔') };
  }
  return { type: 'n95', text: T('Wear a well-fitted N95/KN95 whenever outdoors. Surgical or cloth masks are not enough.', 'باہر نکلتے وقت ہمیشہ اچھی طرح فٹ N95/KN95 ماسک پہنیں۔ سرجیکل یا کپڑے کا ماسک کافی نہیں۔') };
}

function ventilationAdvice(aqi, predictions, T) {
  if (isNum(aqi) && aqi <= 100) {
    return { ok: true, text: T('Air is acceptable: fine to open windows and air out your home.', 'ہوا قابلِ قبول ہے: کھڑکیاں کھول کر گھر کو ہوا دے سکتے ہیں۔') };
  }
  const day = predictions.filter((p) => isNum(p.aqi));
  if (!day.length) {
    return { ok: false, text: T('Keep windows closed while the AQI is high. Air out briefly (10–15 min) only when it improves.', 'AQI زیادہ ہونے تک کھڑکیاں بند رکھیں۔ ہوا بہتر ہو تو صرف 10–15 منٹ کے لیے کھولیں۔') };
  }
  const best = day.reduce((m, p) => (p.aqi < m.aqi ? p : m), day[0]);
  if (best.aqi >= aqi - 5) {
    return { ok: true, best: hhmm(best.time), text: T(`Now is about the cleanest hour in the next 24h. If you need fresh air, open windows briefly (10–15 min) now.`, `اگلے 24 گھنٹوں میں ابھی سب سے صاف وقت ہے۔ تازہ ہوا چاہیے تو ابھی 10–15 منٹ کے لیے کھڑکیاں کھولیں۔`) };
  }
  return {
    ok: false,
    best: hhmm(best.time),
    text: T(`Keep windows closed now. Best time to air out: around ${hhmm(best.time)} (forecast AQI ~${best.aqi}), for 10–15 minutes.`, `ابھی کھڑکیاں بند رکھیں۔ ہوا دینے کا بہترین وقت: تقریباً ${hhmm(best.time)} (متوقع AQI تقریباً ${best.aqi})، صرف 10–15 منٹ کے لیے۔`),
  };
}

/** School guidance (Punjab-style thresholds; stated as guidance, follow official notices). */
function schoolAdvice(aqi, T) {
  const note = T(' Follow official Punjab government / district notices, which take precedence.', ' پنجاب حکومت / ضلعی انتظامیہ کے سرکاری اعلانات کو ترجیح دیں۔');
  if (!isNum(aqi) || aqi <= 100) return { key: 'normal', text: T('Normal school day.', 'معمول کے مطابق اسکول۔') + note };
  if (aqi <= 150) return { key: 'limit', text: T('Classes as normal; limit long or strenuous outdoor activity, especially for children with asthma.', 'کلاسیں معمول کے مطابق؛ باہر کی لمبی یا سخت سرگرمیاں کم کریں، خاص طور پر دمہ والے بچوں کے لیے۔') + note };
  if (aqi <= 200) return { key: 'no_outdoor', text: T('No outdoor sports or assemblies; keep children indoors at break.', 'کھیل اور اسمبلی باہر نہ کروائیں؛ وقفے میں بچوں کو اندر رکھیں۔') + note };
  if (aqi <= 300) return { key: 'indoor_only', text: T('All activities indoors, masks on the way to/from school; consider shorter hours.', 'تمام سرگرمیاں اندر؛ آنے جانے میں ماسک؛ اسکول کے اوقات کم کرنے پر غور کریں۔') + note };
  return { key: 'closure', text: T('Hazardous: recommend closing in person and moving classes online.', 'خطرناک سطح: اسکول بند کر کے آن لائن کلاسز کی سفارش۔') + note };
}

/**
 * Main entry point.
 * @returns {{level, levelLabel, headline, items, bestWindows, ventilate, mask, schoolDecision?, visibilityAlert?, disclaimer}}
 */
export function getAdvice({ profile = 'citizen', current = {}, predictions = [], weather = null, lang = 'en' } = {}) {
  const ur = lang === 'ur';
  const T = (en, urText) => (ur ? urText : en);
  const prof = PROFILES.find((p) => p.id === profile) ? profile : 'citizen';
  const sensitive = SENSITIVE.has(prof);
  const preds = Array.isArray(predictions) ? predictions.filter((p) => p && isNum(p.aqi)) : [];

  const aqi = isNum(current?.aqi) ? Math.round(Number(current.aqi)) : preds[0]?.aqi ?? null;
  // The provider's AQI is often a 24h-average index while forecasts are hourly, so
  // compare trends on the same basis (hourly PM2.5 → AQI) when PM2.5 is given.
  const hourlyAqi = isNum(current?.pm25) ? pm25ToAqi(Number(current.pm25)) : aqi;
  const next6 = preds.slice(0, 6).map((p) => p.aqi);
  const peak6 = next6.length ? Math.max(...next6) : aqi;
  const next24 = preds.slice(0, 24).map((p) => p.aqi);
  const peak24 = next24.length ? Math.max(...next24) : aqi;
  const rising = isNum(hourlyAqi) && isNum(peak6) && peak6 >= hourlyAqi + 20;
  const improving = isNum(hourlyAqi) && next6.length > 0 && Math.min(...next6) <= hourlyAqi - 20;

  // Base risk on the worse of "now" and the next 3 hours.
  const near = preds.slice(0, 3).map((p) => p.aqi);
  const riskAqi = isNum(aqi) ? Math.max(aqi, ...near) : near.length ? Math.max(...near) : null;
  const L = levelIndex(riskAqi, prof);
  const level = LEVELS[L];

  const cat = aqiCategory(aqi);
  const bestWindows = preds.length ? findBestWindows(preds.slice(0, 24)) : [];
  const bw = bestWindows[0];
  const bwText = bw ? `${bw.start}–${bw.end}` : null;
  const mask = maskAdvice(riskAqi, sensitive, T);
  const ventilate = ventilationAdvice(hourlyAqi, preds.slice(0, 24), T);

  // ---------- headline ----------
  const aqiStr = isNum(aqi) ? `AQI ${aqi}` : T('AQI unavailable', 'AQI دستیاب نہیں');
  const catStr = isNum(aqi) ? ` — ${ur ? cat.ur : cat.en}` : '';
  const action = [
    T('Enjoy outdoor activities.', 'باہر کی سرگرمیوں سے لطف اٹھائیں۔'),
    T('Fine for most people; sensitive people take it easy.', 'زیادہ تر لوگوں کے لیے ٹھیک؛ حساس افراد احتیاط کریں۔'),
    T('Reduce time outdoors.', 'باہر کم وقت گزاریں۔'),
    T('Avoid outdoor exertion; mask up outside.', 'باہر مشقت سے بچیں؛ ماسک پہنیں۔'),
    T('Stay indoors as much as possible.', 'جتنا ہو سکے گھر کے اندر رہیں۔'),
  ][L];
  const trend = rising
    ? T(` Forecast: worsening to ~${peak6} in the next 6h.`, ` پیشگوئی: اگلے 6 گھنٹوں میں تقریباً ${peak6} تک بگڑ سکتی ہے۔`)
    : improving
      ? T(' Forecast: improving over the next few hours.', ' پیشگوئی: اگلے چند گھنٹوں میں بہتری متوقع ہے۔')
      : '';
  const headline = `${aqiStr}${catStr}${T('. ', '۔ ')}${action}${trend}`;

  // ---------- reusable items ----------
  const outdoorItem = () => ({
    icon: '🚶',
    title: T('Outdoor activity', 'باہر کی سرگرمیاں'),
    text: [
      T('Normal outdoor activity is fine.', 'باہر معمول کی سرگرمیاں ٹھیک ہیں۔'),
      sensitive ? T('Keep outdoor exercise light and short.', 'باہر ورزش ہلکی اور مختصر رکھیں۔') : T('Outdoor activity is fine; take breaks if you feel irritation.', 'باہر کی سرگرمی ٹھیک ہے؛ جلن محسوس ہو تو وقفہ لیں۔'),
      T('Cut down long or intense outdoor activity; exercise indoors instead.', 'باہر لمبی یا سخت سرگرمی کم کریں؛ ورزش اندر کریں۔'),
      T('Avoid outdoor exercise. Keep necessary trips short.', 'باہر ورزش نہ کریں۔ ضروری کام مختصر رکھیں۔'),
      T('Stay indoors; go out only if essential, with an N95.', 'گھر کے اندر رہیں؛ صرف ضرورت پر N95 پہن کر باہر جائیں۔'),
    ][L] + (bwText && L >= 1 ? T(` Cleanest window: ${bwText}.`, ` سب سے صاف وقت: ${bwText}۔`) : ''),
  });
  const maskItem = () => ({ icon: '😷', title: T('Mask', 'ماسک'), text: mask.text });
  const homeItem = () => ({
    icon: '🏠',
    title: T('At home', 'گھر میں'),
    text: ventilate.text + (L >= 2 ? T(' Wet-mop floors, avoid burning anything indoors; use an air purifier if you have one.', ' فرش گیلے پونچھے سے صاف کریں، گھر میں کچھ نہ جلائیں؛ ایئر پیوریفائر ہو تو چلائیں۔') : ''),
  });
  const bestTimeItem = (en, urText) => (bw ? { icon: '🕒', title: T('Best time outside', 'باہر جانے کا بہترین وقت'), text: T(`${en} ${bestWindows.map((w) => `${w.start}–${w.end} (~${w.avgAqi})`).join(', ')}.`, `${urText} ${bestWindows.map((w) => `${w.start}–${w.end} (~${w.avgAqi})`).join('، ')}۔`) } : null);
  const healthItem = () => ({ icon: '⚕️', title: T('Health', 'صحت'), text: DISCLAIMER[ur ? 'ur' : 'en'] });

  const items = [];
  let schoolDecision;
  const add = (...xs) => xs.forEach((x) => x && items.push(x));

  switch (prof) {
    case 'citizen':
      add(outdoorItem(), maskItem(), homeItem(),
        bestTimeItem('Lowest forecast AQI for errands:', 'کام کاج کے لیے کم ترین متوقع AQI:'),
        L >= 2 ? { icon: '🔥', title: T('Help reduce smog', 'اسموگ کم کرنے میں مدد کریں'), text: T('Don’t burn rubbish or leaves; get your vehicle tuned; share rides when you can.', 'کچرا یا پتے نہ جلائیں؛ گاڑی کی ٹیوننگ کروائیں؛ جہاں ممکن ہو مل کر سفر کریں۔') } : null);
      break;

    case 'parent':
      add(
        { icon: '🧒', title: T('Children outdoors', 'بچوں کا باہر کھیلنا'), text: [
          T('Outdoor play is fine.', 'باہر کھیلنا ٹھیک ہے۔'),
          T('Short outdoor play is OK; watch for coughing.', 'تھوڑی دیر باہر کھیلنا ٹھیک ہے؛ کھانسی پر نظر رکھیں۔'),
          T('Keep outdoor play short and gentle; prefer indoor games.', 'باہر کھیل مختصر اور ہلکا رکھیں؛ اندر کے کھیل بہتر ہیں۔'),
          T('Keep children indoors; no outdoor sports.', 'بچوں کو اندر رکھیں؛ باہر کھیل نہیں۔'),
          T('Keep children indoors all day if possible.', 'ممکن ہو تو بچوں کو سارا دن اندر رکھیں۔'),
        ][L] + (bwText && L >= 1 && L < 4 ? T(` If they go out, ${bwText} looks cleanest.`, ` باہر جانا ہو تو ${bwText} سب سے صاف وقت ہے۔`) : '') },
        L >= 2 ? { icon: '😷', title: T('School run', 'اسکول آنا جانا'), text: T('Use a child-size N95/KN95 that fits snugly; keep car windows up.', 'بچوں کے سائز کا اچھی طرح فٹ N95/KN95 استعمال کریں؛ گاڑی کے شیشے بند رکھیں۔') } : maskItem(),
        { icon: '👀', title: T('Watch for symptoms', 'علامات پر نظر رکھیں'), text: T('Coughing, wheezing, fast breathing or eye irritation mean they should rest indoors. See a doctor if breathing is difficult.', 'کھانسی، سیٹی جیسی سانس، تیز سانس یا آنکھوں میں جلن ہو تو بچے کو اندر آرام کروائیں۔ سانس میں دشواری ہو تو ڈاکٹر کو دکھائیں۔') },
        homeItem(),
        { icon: '💧', title: T('Simple care', 'آسان احتیاط'), text: T('Give plenty of water and warm fluids; wash face and hands after coming in.', 'خوب پانی اور گرم مشروبات دیں؛ باہر سے آ کر منہ ہاتھ دھلوائیں۔') },
      );
      break;

    case 'commuter':
      add(
        bestTimeItem('Least polluted 2-hour travel windows:', 'سفر کے لیے کم آلودہ 2 گھنٹے کے اوقات:') ||
          { icon: '🕒', title: T('Travel timing', 'سفر کا وقت'), text: T('Smog is usually worst late night and early morning; travel later in the day if you can.', 'اسموگ عموماً رات دیر اور صبح سویرے زیادہ ہوتی ہے؛ ممکن ہو تو دن میں سفر کریں۔') },
        { icon: '🚗', title: T('In a car', 'گاڑی میں'), text: L >= 1 ? T('Keep windows up and set the AC to recirculate; replace the cabin filter if it is old.', 'شیشے بند رکھیں اور اے سی کو ری سرکولیشن پر رکھیں؛ کیبن فلٹر پرانا ہو تو بدلیں۔') : T('Normal driving; fresh-air ventilation is fine.', 'معمول کے مطابق سفر؛ باہر کی ہوا کھولنا ٹھیک ہے۔') },
        { icon: '🏍️', title: T('Bike / rickshaw / bus', 'موٹر سائیکل / رکشہ / بس'), text: L >= 1 ? T('Wear an N95/KN95 and a visor or glasses; avoid waiting next to heavy traffic exhaust.', 'N95/KN95 اور ہیلمٹ کا شیشہ یا عینک لگائیں؛ بھاری ٹریفک کے دھوئیں کے پاس انتظار نہ کریں۔') : T('No special precautions needed today.', 'آج کسی خاص احتیاط کی ضرورت نہیں۔') },
        maskItem(),
        L >= 2 ? { icon: '🏢', title: T('Work from home', 'گھر سے کام'), text: T('If your job allows, working from home today cuts your exposure.', 'اگر ممکن ہو تو آج گھر سے کام کریں، اس سے آلودگی کا سامنا کم ہوگا۔') } : null,
      );
      break;

    case 'rider':
      add(
        { icon: '🕒', title: T('Shift timing', 'شفٹ کا وقت'), text: bw
          ? T(`Plan more of your hours around the cleaner windows: ${bestWindows.map((w) => `${w.start}–${w.end}`).join(', ')}. Avoid very late night and early morning if you can.`, `زیادہ کام صاف اوقات میں رکھیں: ${bestWindows.map((w) => `${w.start}–${w.end}`).join('، ')}۔ ممکن ہو تو رات دیر اور صبح سویرے سے بچیں۔`)
          : T('Smog is usually worst late night and early morning; prefer daytime shifts.', 'اسموگ عموماً رات دیر اور صبح سویرے زیادہ ہوتی ہے؛ دن کی شفٹ بہتر ہے۔') },
        { icon: '😷', title: T('Mask & eyes', 'ماسک اور آنکھیں'), text: L >= 1 ? T('Wear an N95/KN95 under your helmet and keep the visor down. Change the mask when it gets dirty or damp.', 'ہیلمٹ کے نیچے N95/KN95 پہنیں اور شیشہ نیچے رکھیں۔ ماسک گندا یا گیلا ہو تو بدل دیں۔') : mask.text },
        { icon: '☕', title: T('Breaks', 'وقفے'), text: L >= 2 ? T('Take a 10–15 min break indoors every 2 hours (shop, restaurant, hub). Drink water.', 'ہر 2 گھنٹے بعد 10–15 منٹ کسی دکان، ریسٹورنٹ یا ہب کے اندر آرام کریں۔ پانی پیتے رہیں۔') : T('Take regular short breaks and drink water.', 'باقاعدگی سے مختصر وقفے لیں اور پانی پیتے رہیں۔') },
        { icon: '🚦', title: T('On the road', 'سڑک پر'), text: T('Don’t wait right behind buses or trucks at signals; keep some distance from exhaust.', 'سگنل پر بسوں یا ٹرکوں کے بالکل پیچھے نہ رکیں؛ دھوئیں سے فاصلہ رکھیں۔') },
        L >= 3 ? { icon: '🤒', title: T('Know when to stop', 'کب رکنا ہے'), text: T('If you feel dizzy, breathless or have chest tightness, stop riding and rest indoors.', 'چکر، سانس پھولنے یا سینے میں جکڑن محسوس ہو تو سواری روکیں اور اندر آرام کریں۔') } : null,
      );
      break;

    case 'asthma':
      add(
        { icon: '💊', title: T('Medicines', 'ادویات'), text: T('Keep taking your regular medicines and always carry your reliever inhaler. Follow your asthma/heart action plan.', 'اپنی باقاعدہ ادویات جاری رکھیں اور ریلیور انہیلر ہمیشہ ساتھ رکھیں۔ ڈاکٹر کے دیے گئے پلان پر عمل کریں۔') },
        outdoorItem(),
        maskItem(),
        homeItem(),
        { icon: '🚨', title: T('Warning signs', 'خطرے کی علامات'), text: T('If your inhaler is needed more often, or you have chest pain, breathlessness or palpitations, contact your doctor; call 1122 in an emergency. This is not medical advice.', 'اگر انہیلر بار بار لینا پڑے، یا سینے میں درد، سانس پھولنا یا دل کی دھڑکن تیز ہو تو ڈاکٹر سے رابطہ کریں؛ ہنگامی صورت میں 1122۔ یہ طبی مشورہ نہیں۔') },
      );
      break;

    case 'elderly':
      add(
        { icon: '🚶', title: T('Walks', 'سیر'), text: L >= 2
          ? T(`Skip early-morning walks while smog is high; walk indoors or at a cleaner hour${bwText ? ` (around ${bwText})` : ''}.`, `اسموگ زیادہ ہو تو صبح سویرے کی سیر نہ کریں؛ گھر کے اندر یا صاف وقت${bwText ? ` (تقریباً ${bwText})` : ''} میں چہل قدمی کریں۔`)
          : T('A gentle walk is fine; mid-day is usually cleaner than early morning.', 'ہلکی سیر ٹھیک ہے؛ دوپہر عموماً صبح سویرے سے زیادہ صاف ہوتی ہے۔') },
        maskItem(),
        { icon: '💊', title: T('Medicines', 'ادویات'), text: T('Keep regular medicines (BP, heart, lungs) stocked and on time.', 'باقاعدہ ادویات (بلڈ پریشر، دل، پھیپھڑے) گھر میں رکھیں اور وقت پر لیں۔') },
        homeItem(),
        { icon: '🤝', title: T('Stay in touch', 'رابطہ رکھیں'), text: T('Let family know how you feel; neighbours, please check on elderly people living alone.', 'گھر والوں کو اپنی طبیعت بتاتے رہیں؛ پڑوسی اکیلے رہنے والے بزرگوں کی خبر رکھیں۔') },
        healthItem(),
      );
      break;

    case 'school': {
      const schoolAqi = (() => {
        const hrs = preds.slice(0, 24).filter((p) => { const h = hourOf(p.time); return h >= 7 && h <= 14; }).map((p) => p.aqi);
        return Math.max(isNum(aqi) ? aqi : 0, ...(hrs.length ? hrs : [0])) || aqi;
      })();
      const sd = schoolAdvice(schoolAqi, T);
      add(
        { icon: '🏫', title: T('Today’s decision', 'آج کا فیصلہ'), text: sd.text },
        { icon: '⚽', title: T('Sports & assembly', 'کھیل اور اسمبلی'), text: schoolAqi > 150 ? T('Move assemblies and PE indoors.', 'اسمبلی اور کھیل کی کلاس اندر منتقل کریں۔') : schoolAqi > 100 ? T('Keep PE light; let sensitive students sit out.', 'کھیل ہلکا رکھیں؛ حساس طلبہ کو چھوٹ دیں۔') : T('Outdoor PE and assemblies are fine.', 'باہر کھیل اور اسمبلی ٹھیک ہے۔') },
        { icon: '🪟', title: T('Classrooms & offices', 'کلاس روم اور دفاتر'), text: ventilate.text + (schoolAqi > 150 ? T(' Run air purifiers where available.', ' جہاں ممکن ہو ایئر پیوریفائر چلائیں۔') : '') },
        { icon: '📋', title: T('Sensitive students & staff', 'حساس طلبہ اور عملہ'), text: T('Keep a list of students/staff with asthma; make sure inhalers are on site.', 'دمہ والے طلبہ اور عملے کی فہرست رکھیں؛ یقینی بنائیں کہ ان کے انہیلر موجود ہوں۔') },
        { icon: '📣', title: T('Inform parents', 'والدین کو آگاہ کریں'), text: T('Send a short message on today’s plan and remind about masks for the commute.', 'آج کے پلان کے بارے میں مختصر پیغام بھیجیں اور سفر کے لیے ماسک کی یاد دہانی کرائیں۔') },
      );
      schoolDecision = sd;
      break;
    }

    case 'clinic': {
      const surge = (isNum(peak24) && peak24 > 150) || rising;
      add(
        { icon: '📈', title: T('Expected caseload', 'متوقع مریض'), text: surge
          ? T(`Expect more respiratory and cardiac visits over the next 24–72h (forecast peak AQI ~${peak24}${rising ? ', rising' : ''}).`, `اگلے 24–72 گھنٹوں میں سانس اور دل کے مریضوں میں اضافہ متوقع ہے (متوقع زیادہ سے زیادہ AQI تقریباً ${peak24}${rising ? '، بڑھ رہا ہے' : ''})۔`)
          : T('No major smog-related surge expected in the next 24h.', 'اگلے 24 گھنٹوں میں اسموگ سے متعلق مریضوں میں بڑا اضافہ متوقع نہیں۔') },
        { icon: '🚑', title: T('Triage', 'ٹرائیج'), text: T('Prioritise breathlessness, low SpO₂, chest pain; check SpO₂ early for children, elderly, COPD/asthma and heart patients.', 'سانس پھولنے، کم SpO₂ اور سینے کے درد کو ترجیح دیں؛ بچوں، بزرگوں، دمہ/COPD اور دل کے مریضوں کا SpO₂ جلد چیک کریں۔') },
        { icon: '📦', title: T('Supplies', 'سامان'), text: T('Check stock of nebulisers, bronchodilators, spacers, oxygen and N95 masks.', 'نیبولائزر، برونکوڈائلیٹر، اسپیسر، آکسیجن اور N95 ماسک کا اسٹاک چیک کریں۔') },
        { icon: '😷', title: T('Staff protection', 'عملے کا تحفظ'), text: T('Staff working outdoors or in triage areas should wear N95s; keep waiting areas closed off from outside air.', 'باہر یا ٹرائیج میں کام کرنے والا عملہ N95 پہنے؛ انتظار گاہوں کو باہر کی ہوا سے بچائیں۔') },
        { icon: '🗒️', title: T('Patient advice', 'مریضوں کو مشورہ'), text: T('Remind discharged patients: stay indoors on high-AQI days, use masks, keep inhalers, return if symptoms worsen.', 'ڈسچارج ہونے والے مریضوں کو یاد دلائیں: زیادہ AQI والے دن اندر رہیں، ماسک پہنیں، انہیلر ساتھ رکھیں، طبیعت بگڑے تو واپس آئیں۔') },
      );
      break;
    }

    case 'farmer':
      add(
        { icon: '🚫', title: T('Burning ban', 'جلانے پر پابندی'), text: T('Burning crop residue is banned in Punjab during the smog season. Violations can bring fines, FIRs and arrests; check your district’s current notices.', 'اسموگ کے موسم میں پنجاب میں فصل کی باقیات جلانے پر پابندی ہے۔ خلاف ورزی پر جرمانہ، ایف آئی آر اور گرفتاری ہو سکتی ہے؛ اپنے ضلع کے تازہ احکامات دیکھیں۔') },
        { icon: '🚜', title: T('Happy Seeder / Super Seeder', 'ہیپی سیڈر / سپر سیڈر'), text: T('Sow wheat directly into rice stubble without burning. Ask the Agriculture Department about subsidised machines or renting one.', 'باقیات جلائے بغیر چاول کے کھیت میں براہِ راست گندم کاشت کریں۔ رعایتی مشین یا کرائے پر لینے کے لیے محکمہ زراعت سے رابطہ کریں۔') },
        { icon: '🌱', title: T('Mulch or mix into soil', 'ملچنگ یا مٹی میں ملانا'), text: T('Chop the straw and leave it as mulch or plough it in: it adds organic matter and saves water.', 'پرالی کاٹ کر کھیت میں بچھا دیں یا ہل چلا کر مٹی میں ملا دیں: اس سے زمین زرخیز ہوتی ہے اور پانی بچتا ہے۔') },
        { icon: '💰', title: T('Sell the residue', 'باقیات بیچیں'), text: T('Straw can be sold for fodder, to biomass/power plants, or to paper and board mills.', 'پرالی چارے کے لیے، بائیوماس/بجلی گھروں کو، یا کاغذ اور گتے کے کارخانوں کو بیچی جا سکتی ہے۔') },
        { icon: '😷', title: T('Your health in the field', 'کھیت میں اپنی صحت'), text: (L >= 1 ? T('Wear an N95/KN95 during dusty fieldwork and threshing. ', 'گرد والے کام اور گہائی کے دوران N95/KN95 پہنیں۔ ') : '') + (bwText ? T(`Cleanest working hours: ${bwText}.`, `کام کے لیے سب سے صاف وقت: ${bwText}۔`) : T('Prefer mid-day for heavy work.', 'بھاری کام کے لیے دوپہر کا وقت بہتر ہے۔')) },
      );
      break;

    case 'business':
      add(
        { icon: '📅', title: T('Shift planning', 'شفٹ کی منصوبہ بندی'), text: bw
          ? T(`Schedule outdoor tasks, loading and deliveries in the cleaner windows: ${bestWindows.map((w) => `${w.start}–${w.end}`).join(', ')}.`, `باہر کے کام، لوڈنگ اور ڈیلیوری صاف اوقات میں رکھیں: ${bestWindows.map((w) => `${w.start}–${w.end}`).join('، ')}۔`)
          : T('Schedule outdoor tasks in the afternoon, when smog is usually lower.', 'باہر کے کام دوپہر میں رکھیں جب اسموگ عموماً کم ہوتی ہے۔') },
        { icon: '👷', title: T('Outdoor workers', 'باہر کام کرنے والے'), text: L >= 1 ? T('Provide N95/KN95 masks, rotate staff between indoor and outdoor tasks, and allow indoor breaks.', 'N95/KN95 ماسک فراہم کریں، عملے کو اندر اور باہر کے کاموں میں باری باری لگائیں، اور اندر وقفے دیں۔') : T('Normal operations; keep masks ready for smog days.', 'معمول کے مطابق کام؛ اسموگ والے دنوں کے لیے ماسک تیار رکھیں۔') },
        { icon: '🏢', title: T('Indoor air', 'اندر کی ہوا'), text: ventilate.text + (L >= 2 ? T(' Keep doors closed; run purifiers in customer areas.', ' دروازے بند رکھیں؛ گاہکوں کی جگہ پر ایئر پیوریفائر چلائیں۔') : '') },
        L >= 2 ? { icon: '💻', title: T('Remote work', 'گھر سے کام'), text: T('Where possible, let office staff work from home on very high AQI days.', 'جہاں ممکن ہو، بہت زیادہ AQI والے دن دفتری عملے کو گھر سے کام کی اجازت دیں۔') } : null,
        { icon: '⚙️', title: T('Compliance', 'ضوابط کی پابندی'), text: T('Keep generators and boilers maintained, don’t burn waste, and follow any smog-emergency orders from the Punjab government.', 'جنریٹر اور بوائلر کی دیکھ بھال رکھیں، کچرا نہ جلائیں، اور پنجاب حکومت کے اسموگ ایمرجنسی احکامات پر عمل کریں۔') },
      );
      break;
  }

  // Keep 3–6 items.
  while (items.length < 3) items.push(items.length === 0 ? outdoorItem() : healthItem());
  if (items.length > 6) items.length = 6;

  // ---------- visibility alert ----------
  let visibilityAlert;
  const vis = weather && isNum(weather.visibility) ? Number(weather.visibility) : null;
  if (vis !== null && vis < 1000) {
    const severe = vis < 200;
    const m = Math.round(vis);
    visibilityAlert = {
      severity: severe ? 'severe' : 'warning',
      visibility: m,
      text: T(
        `Low visibility (~${m} m) from fog/smog. Drive slowly, use low-beam headlights and fog lights (not high beam), keep a long gap, and avoid motorways if possible.`,
        `دھند/اسموگ کی وجہ سے حدِ نگاہ کم ہے (تقریباً ${m} میٹر)۔ آہستہ چلائیں، لو بیم اور فوگ لائٹس استعمال کریں (ہائی بیم نہیں)، فاصلہ زیادہ رکھیں، اور ممکن ہو تو موٹروے سے گریز کریں۔`,
      ) + (severe ? T(' Postpone non-essential travel.', ' غیر ضروری سفر ملتوی کریں۔') : ''),
    };
  }

  const result = {
    level,
    levelLabel: LEVEL_LABEL[level][ur ? 'ur' : 'en'],
    headline,
    items,
    bestWindows,
    ventilate,
    mask,
    disclaimer: DISCLAIMER[ur ? 'ur' : 'en'],
  };
  if (prof === 'school' || prof === 'parent') {
    result.schoolDecision = schoolDecision || schoolAdvice(riskAqi, T);
  }
  if (visibilityAlert) result.visibilityAlert = visibilityAlert;
  return result;
}
