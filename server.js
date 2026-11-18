// Saaf Saans — صاف سانس : backend for live air quality, smog forecast data and the AI assistant.
import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, "data");
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");
const TZ = "Asia/Karachi";

const AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const WX_URL = "https://api.open-meteo.com/v1/forecast";
const AQ_SOURCE = { name: "Open-Meteo Air Quality API (CAMS)", url: "https://open-meteo.com/en/docs/air-quality-api" };
const WX_SOURCE = { name: "Open-Meteo Weather API", url: "https://open-meteo.com/en/docs" };

const CITIES = [
  { id: "lahore", lat: 31.5204, lon: 74.3587, name: "Lahore", nameUr: "لاہور" },
  { id: "karachi", lat: 24.8607, lon: 67.0011, name: "Karachi", nameUr: "کراچی" },
  { id: "islamabad", lat: 33.6844, lon: 73.0479, name: "Islamabad", nameUr: "اسلام آباد" },
  { id: "rawalpindi", lat: 33.5651, lon: 73.0169, name: "Rawalpindi", nameUr: "راولپنڈی" },
  { id: "peshawar", lat: 34.0151, lon: 71.5249, name: "Peshawar", nameUr: "پشاور" },
  { id: "multan", lat: 30.1575, lon: 71.5249, name: "Multan", nameUr: "ملتان" },
  { id: "faisalabad", lat: 31.4504, lon: 73.135, name: "Faisalabad", nameUr: "فیصل آباد" },
  { id: "gujranwala", lat: 32.1877, lon: 74.1945, name: "Gujranwala", nameUr: "گوجرانوالہ" },
];
const cityById = (id) => CITIES.find((c) => c.id === String(id || "").toLowerCase());

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, error, message) {
    super(message);
    this.status = status;
    this.code = error;
  }
}

async function fetchUpstream(url, as = "json", timeoutMs = 15000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "SaafSaans/1.0" } });
  if (!res.ok) throw new Error(`Upstream ${new URL(url).host} responded ${res.status}`);
  return as === "text" ? res.text() : res.json();
}

// In-memory cache: key -> { data, fetchedAt }. Serves stale data (stale:true) if a refresh fails.
const cache = new Map();
const inflight = new Map();
async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < ttlMs) return hit.data;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const fetchedAt = Date.now();
      const data = { ...(await loader()), updatedAt: new Date(fetchedAt).toISOString() };
      cache.set(key, { data, fetchedAt });
      return data;
    } catch (err) {
      if (hit) {
        console.warn(`[cache] ${key} refresh failed, serving stale: ${err.message}`);
        return { ...hit.data, stale: true };
      }
      throw new HttpError(502, "upstream_error", `Could not fetch live data: ${err.message}`);
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// Current Asia/Karachi local hour formatted like Open-Meteo times: "YYYY-MM-DDTHH:00"
function karachiHourString(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00`;
}

// Simple fixed-window per-IP rate limiter.
function rateLimit({ max, windowMs }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, v] of hits) if (now > v.reset) hits.delete(ip);
  }, windowMs).unref();
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let entry = hits.get(ip);
    if (!entry || now > entry.reset) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: "rate_limited", message: "Too many requests, please try again in a few minutes." });
    }
    next();
  };
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- app ----------
const app = express();
app.set("trust proxy", "loopback");
app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

// 1. All cities: current air quality
app.get("/api/cities", wrap(async (req, res) => {
  const data = await cached("cities", 10 * 60 * 1000, async () => {
    const params = new URLSearchParams({
      latitude: CITIES.map((c) => c.lat).join(","),
      longitude: CITIES.map((c) => c.lon).join(","),
      current: "us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide",
      timezone: TZ,
    });
    let json = await fetchUpstream(`${AQ_URL}?${params}`);
    if (!Array.isArray(json)) json = [json];
    if (json.length !== CITIES.length) throw new Error("Unexpected response shape from Open-Meteo");
    return {
      source: AQ_SOURCE.name,
      sourceUrl: AQ_SOURCE.url,
      cities: CITIES.map((c, i) => {
        const cur = json[i]?.current || {};
        return {
          id: c.id, name: c.name, nameUr: c.nameUr, lat: c.lat, lon: c.lon,
          aqi: cur.us_aqi ?? null,
          pm25: cur.pm2_5 ?? null,
          pm10: cur.pm10 ?? null,
          no2: cur.nitrogen_dioxide ?? null,
          o3: cur.ozone ?? null,
          co: cur.carbon_monoxide ?? null,
          time: cur.time ?? null,
        };
      }),
    };
  });
  res.json(data);
}));

// 2. Current weather for a city
app.get("/api/weather", wrap(async (req, res) => {
  const city = cityById(req.query.city || "lahore");
  if (!city) throw new HttpError(400, "unknown_city", `Unknown city. Use one of: ${CITIES.map((c) => c.id).join(", ")}`);
  const data = await cached(`weather:${city.id}`, 10 * 60 * 1000, async () => {
    const params = new URLSearchParams({
      latitude: city.lat, longitude: city.lon,
      current: "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,visibility,weather_code",
      timezone: TZ,
    });
    const json = await fetchUpstream(`${WX_URL}?${params}`);
    const cur = json.current || {};
    return {
      source: WX_SOURCE.name,
      sourceUrl: WX_SOURCE.url,
      current: {
        time: cur.time ?? null,
        temperature: cur.temperature_2m ?? null,
        humidity: cur.relative_humidity_2m ?? null,
        windSpeed: cur.wind_speed_10m ?? null, // km/h
        windDirection: cur.wind_direction_10m ?? null,
        visibility: cur.visibility ?? null, // metres
        weatherCode: cur.weather_code ?? null,
      },
    };
  });
  res.json(data);
}));

// 3. 30 days of hourly history + 3 days of provider forecast, aligned
app.get("/api/history", wrap(async (req, res) => {
  const city = cityById(req.query.city || "lahore");
  if (!city) throw new HttpError(400, "unknown_city", `Unknown city. Use one of: ${CITIES.map((c) => c.id).join(", ")}`);
  const data = await cached(`history:${city.id}`, 30 * 60 * 1000, async () => {
    const common = { latitude: city.lat, longitude: city.lon, past_days: 30, forecast_days: 3, timezone: TZ };
    const [aq, wx] = await Promise.all([
      fetchUpstream(`${AQ_URL}?${new URLSearchParams({ ...common, hourly: "pm2_5,pm10,us_aqi" })}`),
      fetchUpstream(`${WX_URL}?${new URLSearchParams({
        ...common, hourly: "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,visibility",
      })}`),
    ]);
    const aqH = aq.hourly || {}, wxH = wx.hourly || {};
    const wxIndex = new Map((wxH.time || []).map((t, i) => [t, i]));
    const hourly = { time: [], pm25: [], pm10: [], aqi: [], windSpeed: [], windDirection: [], temperature: [], humidity: [], visibility: [] };
    const v = (arr, i) => (arr && arr[i] != null ? arr[i] : null);
    (aqH.time || []).forEach((t, i) => {
      const j = wxIndex.get(t);
      if (j === undefined) return;
      hourly.time.push(t);
      hourly.pm25.push(v(aqH.pm2_5, i));
      hourly.pm10.push(v(aqH.pm10, i));
      hourly.aqi.push(v(aqH.us_aqi, i));
      hourly.windSpeed.push(v(wxH.wind_speed_10m, j));
      hourly.windDirection.push(v(wxH.wind_direction_10m, j));
      hourly.temperature.push(v(wxH.temperature_2m, j));
      hourly.humidity.push(v(wxH.relative_humidity_2m, j));
      hourly.visibility.push(v(wxH.visibility, j));
    });
    if (!hourly.time.length) throw new Error("No overlapping hourly data from Open-Meteo");
    return {
      city: city.id,
      sources: [AQ_SOURCE, WX_SOURCE],
      hourly,
    };
  });
  // nowIndex is computed per request so it stays correct while the cache is warm.
  const nowStr = karachiHourString();
  let nowIndex = -1;
  data.hourly.time.forEach((t, i) => { if (t <= nowStr) nowIndex = i; });
  res.json({ ...data, nowIndex: Math.max(nowIndex, 0) });
}));

// 4. Active fires (NASA FIRMS)
// Satellites tried in order; the first one with detections is used (S-NPP sometimes has data gaps).
const FIRMS_SOURCES = [
  ["VIIRS_NOAA21_NRT", "VIIRS NOAA-21"],
  ["VIIRS_NOAA20_NRT", "VIIRS NOAA-20"],
  ["VIIRS_SNPP_NRT", "VIIRS S-NPP"],
  ["MODIS_NRT", "MODIS"],
];

function parseFirmsCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const header = (lines.shift() || "").split(",").map((h) => h.trim());
  const col = (n) => header.indexOf(n);
  const idx = {
    lat: col("latitude"), lon: col("longitude"),
    brightness: col("bright_ti4") >= 0 ? col("bright_ti4") : col("brightness"),
    frp: col("frp"), confidence: col("confidence"), date: col("acq_date"), time: col("acq_time"),
  };
  if (idx.lat < 0 || idx.lon < 0) throw new Error(`FIRMS returned unexpected data: ${csv.slice(0, 120)}`);
  const num = (x) => (x === undefined || x === "" ? null : Number(x));
  const fires = [];
  for (const line of lines) {
    if (fires.length >= 1500) break;
    const f = line.split(",");
    const lat = num(f[idx.lat]), lon = num(f[idx.lon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    fires.push({
      lat, lon,
      brightness: num(f[idx.brightness]),
      frp: num(f[idx.frp]),
      confidence: f[idx.confidence] ?? null,
      date: f[idx.date] ?? null,
      time: f[idx.time] ?? null,
    });
  }
  return fires;
}

app.get("/api/fires", wrap(async (req, res) => {
  const key = process.env.FIRMS_MAP_KEY;
  const sourceUrl = "https://firms.modaps.eosdis.nasa.gov/";
  if (!key) return res.json({ configured: false, updatedAt: null, source: "NASA FIRMS (VIIRS NRT)", sourceUrl, fires: [] });
  const data = await cached("fires", 30 * 60 * 1000, async () => {
    let last = null, lastErr = null;
    for (const [product, label] of FIRMS_SOURCES) {
      try {
        const csv = await fetchUpstream(
          `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${product}/69,27.5,77,34/2`,
          "text",
          60000 // FIRMS can be slow
        );
        const fires = parseFirmsCsv(csv);
        last = { configured: true, source: `NASA FIRMS (${label} NRT)`, sourceUrl, fires };
        if (fires.length) break;
      } catch (err) {
        lastErr = err;
        console.warn(`[fires] ${product} failed: ${err.message}`);
      }
    }
    if (!last) throw lastErr || new Error("FIRMS unavailable");
    return last;
  });
  res.json(data);
}));

// 5. AI assistant (Claude)
const SYSTEM_PROMPT = `You are "Saaf Saans" (صاف سانس), a friendly air-quality and health advisor for residents of Lahore, Pakistan, during the winter smog season.

How to answer:
- Base your advice on the live data provided below. Never invent AQI, PM2.5, weather or forecast numbers beyond what is given; if something isn't in the data, say you don't have it.
- Be concise (under about 150 words) and practical: when to wear N95/KN95 masks (cloth and surgical masks do little against PM2.5), using air purifiers, when to ventilate (open windows when AQI is lowest, usually afternoon with more wind), timing outdoor exercise and the school run, and extra care for children, the elderly, pregnant women and people with asthma or heart/lung disease.
- You are not a doctor. For emergencies (severe breathlessness, chest pain) tell people to call Rescue 1122 or go to the nearest hospital.
- Use simple language and short bullet points where helpful.`;

const rateLimitChat = rateLimit({ max: 20, windowMs: 5 * 60 * 1000 });
let anthropicClient = null;

// The chat UI shows plain text, so strip common Markdown from model replies.
function plainText(t) {
  return String(t)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

// Free fallback LLM (no key needed). Limited to ~1 reply per 45 s per IP by the provider.
async function askFreeModel(system, messages, ur) {
  let r;
  try {
    r = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai",
        messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch (err) {
    console.error("[chat] free model unreachable:", err.message);
    throw new HttpError(502, "ai_error", "The AI service could not be reached. Please try again.");
  }
  const data = await r.json().catch(() => null);
  if (r.status === 402 || r.status === 429) {
    const wait = Number(String(data?.error?.message || "").match(/(\d+)\s*s/)?.[1]) || 45;
    throw new HttpError(429, "ai_rate_limited", ur
      ? `مفت AI سروس مصروف ہے۔ براہِ کرم ${wait} سیکنڈ بعد دوبارہ کوشش کریں۔`
      : `The free AI service allows one reply every ~45 seconds. Please try again in ${wait} seconds.`);
  }
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!r.ok || !reply) {
    console.error("[chat] free model error:", r.status, JSON.stringify(data).slice(0, 300));
    throw new HttpError(502, "ai_error", "The AI service returned an error. Please try again.");
  }
  return plainText(reply);
}

app.post("/api/chat", rateLimitChat, wrap(async (req, res) => {
  const { messages, lang, context } = req.body || {};
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 20) {
    throw new HttpError(400, "invalid_messages", "messages must be an array of 1–20 items");
  }
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string" || !m.content.trim()) {
      throw new HttpError(400, "invalid_messages", "each message needs role 'user' or 'assistant' and non-empty string content");
    }
    if (m.content.length > 2000) throw new HttpError(400, "invalid_messages", "each message must be at most 2000 characters");
  }
  if (messages[messages.length - 1].role !== "user") {
    throw new HttpError(400, "invalid_messages", "the last message must be from the user");
  }
  const ur = lang === "ur";
  const ctx = context && typeof context === "object" ? context : {};
  const s = (x, max = 600) => (x === undefined || x === null ? "unknown" : String(typeof x === "object" ? JSON.stringify(x) : x).slice(0, max));
  const liveContext = `

Live data (as of ${new Date().toISOString()}, sources: Open-Meteo CAMS air quality, Open-Meteo weather, in-app forecast model):
- City: ${s(ctx.city, 60)}
- Current US AQI: ${s(ctx.aqi, 20)} (${s(ctx.category, 60)})
- Current PM2.5 (µg/m³): ${s(ctx.pm25, 20)}
- Forecast summary: ${s(ctx.forecastSummary)}
- Weather: ${s(ctx.weather)}

Reply language: ${ur ? "Urdu, written in Urdu script (اردو)." : "English."}`;

  // No Anthropic key: use the free, keyless Pollinations.ai text API instead.
  if (!process.env.ANTHROPIC_API_KEY) {
    const reply = await askFreeModel(SYSTEM_PROMPT + liveContext, messages, ur);
    return res.json({ reply, provider: "pollinations" });
  }

  anthropicClient ??= new Anthropic();
  try {
    const response = await anthropicClient.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM_PROMPT + liveContext,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    if (response.stop_reason === "refusal") {
      return res.json({
        reply: ur
          ? "معذرت، میں اس سوال کا جواب نہیں دے سکتا۔ براہِ کرم فضائی آلودگی یا صحت سے متعلق کوئی اور سوال پوچھیں۔"
          : "Sorry, I can't help with that request. Please ask me something about air quality or staying healthy in the smog.",
      });
    }
    const reply = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    res.json({ reply: plainText(reply) || (ur ? "معذرت، کوئی جواب نہیں ملا۔" : "Sorry, I couldn't generate a reply.") });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new HttpError(429, "ai_rate_limited", "The AI assistant is busy right now. Please try again shortly.");
    } else if (err instanceof Anthropic.APIError) {
      console.error("[chat] Anthropic API error:", err.status, err.message);
      throw new HttpError(502, "ai_error", "The AI service returned an error. Please try again.");
    }
    console.error("[chat] unexpected error:", err);
    throw new HttpError(500, "internal_error", "Something went wrong with the AI assistant.");
  }
}));

// 6. Community pollution reports
const REPORT_TYPES = new Set(["crop_burning", "waste_burning", "brick_kiln", "industrial", "other"]);
const rateLimitReports = rateLimit({ max: 10, windowMs: 5 * 60 * 1000 });
let reportsCache = null;
let writeChain = Promise.resolve();

async function loadReports() {
  if (reportsCache) return reportsCache;
  try {
    const parsed = JSON.parse(await readFile(REPORTS_FILE, "utf8"));
    reportsCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    reportsCache = [];
  }
  return reportsCache;
}
function saveReports(list) {
  writeChain = writeChain.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${REPORTS_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(list, null, 2));
    await rename(tmp, REPORTS_FILE);
  });
  return writeChain;
}
const cleanNote = (note) =>
  String(note ?? "").replace(/<[^>]*>/g, "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

app.get("/api/reports", wrap(async (req, res) => {
  const list = await loadReports();
  res.json({ reports: [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
}));

app.post("/api/reports", rateLimitReports, wrap(async (req, res) => {
  const { type, lat, lon, note } = req.body || {};
  if (!REPORT_TYPES.has(type)) throw new HttpError(400, "invalid_type", `type must be one of: ${[...REPORT_TYPES].join(", ")}`);
  const la = Number(lat), lo = Number(lon);
  if (lat === null || lat === "" || !Number.isFinite(la) || la < 23 || la > 37) throw new HttpError(400, "invalid_lat", "lat must be a number between 23 and 37");
  if (lon === null || lon === "" || !Number.isFinite(lo) || lo < 60 || lo > 78) throw new HttpError(400, "invalid_lon", "lon must be a number between 60 and 78");
  if (note !== undefined && note !== null && typeof note !== "string") throw new HttpError(400, "invalid_note", "note must be a string");
  const text = cleanNote(note);
  if (text.length > 280) throw new HttpError(400, "invalid_note", "note must be at most 280 characters");

  const report = {
    id: randomUUID(),
    type,
    lat: Math.round(la * 1e5) / 1e5,
    lon: Math.round(lo * 1e5) / 1e5,
    note: text,
    createdAt: new Date().toISOString(),
  };
  const list = await loadReports();
  list.push(report);
  if (list.length > 500) list.splice(0, list.length - 500);
  await saveReports(list);
  res.status(201).json({ report });
}));

// 7. Health
app.get("/api/health", (req, res) => {
  res.json({ ok: true, anthropic: !!process.env.ANTHROPIC_API_KEY, ai: process.env.ANTHROPIC_API_KEY ? "claude" : "pollinations (free)", firms: !!process.env.FIRMS_MAP_KEY });
});

// ---------- errors ----------
app.use("/api", (req, res) => res.status(404).json({ error: "not_found", message: "Unknown API endpoint" }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "invalid_json", message: "Request body is not valid JSON" });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "too_large", message: "Request body is too large" });
  console.error(err);
  res.status(500).json({ error: "internal_error", message: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Saaf Saans — صاف سانس running at http://localhost:${PORT}`);
  // Warm the caches so the first visitor doesn't wait on slow upstreams (FIRMS especially).
  for (const p of ["/api/cities", "/api/weather?city=lahore", "/api/history?city=lahore", "/api/fires"]) {
    fetch(`http://localhost:${PORT}${p}`).catch(() => {});
  }
});
