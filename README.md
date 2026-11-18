# Saaf Saans — صاف سانس

A bilingual (English / اردو) web app for Lahore's winter smog, built for **CodeBlue Lahore — Hack 4 Clean Air**. It shows live air quality for Lahore and seven other Pakistani cities, forecasts the next hours of PM2.5, maps active fires and community pollution reports, and has an AI assistant that gives practical health advice based on the live data.

## Features
- **Live AQI dashboard**: US AQI, PM2.5, PM10, NO₂, O₃ and CO for Lahore, Karachi, Islamabad, Rawalpindi, Peshawar, Multan, Faisalabad and Gujranwala. Every number shows its source and refresh time.
- **Weather context**: wind, humidity, temperature and visibility, which drive smog build-up.
- **30-day history + forecast**: hourly PM2.5/AQI charts with the provider forecast and our own forecast model.
- **Fire map**: NASA FIRMS satellite fire detections (crop and waste burning) over Punjab and KP.
- **Community reports**: anyone can pin crop burning, waste burning, brick kilns or industrial smoke on the map.
- **AI assistant "Saaf Saans"**: answers in English or Urdu about masks, purifiers, ventilation, school-run timing and vulnerable groups, grounded in the live data.

## Tracks covered
Real-time air-quality monitoring, AI/ML forecasting, public health awareness and citizen reporting.

## How to run
Requires Node.js 18 or newer.

```bash
npm install
cp .env.example .env   # then add your keys (both optional)
npm start
```

Open http://localhost:3000. Use `npm run dev` to auto-restart on changes.

### Free keys (optional)
- `FIRMS_MAP_KEY`: NASA FIRMS map key, free from https://firms.modaps.eosdis.nasa.gov/api/map_key/ (without it the fire layer is turned off).
- `ANTHROPIC_API_KEY`: from https://console.anthropic.com (without it the AI assistant is turned off).

Everything else uses free public APIs that need no key.

## Data sources
- **Air quality**: [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api) (Copernicus CAMS model data). Refreshed every 10 min, history every 30 min.
- **Weather**: [Open-Meteo Weather API](https://open-meteo.com/en/docs).
- **Fires**: [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) VIIRS S-NPP near-real-time detections, last 2 days.
- **Map tiles**: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- **Community reports**: submitted by users, stored locally in `data/reports.json`.

## API
`GET /api/cities`, `GET /api/weather?city=`, `GET /api/history?city=`, `GET /api/fires`, `POST /api/chat`, `GET|POST /api/reports`, `GET /api/health`. Every data response includes `updatedAt`, its source and source URL; if an upstream API fails, the last good data is returned with `stale: true`.

## AI & libraries disclosure
- **Claude API (Anthropic)** powers the chat assistant (`claude-opus-5-5`), via the official `@anthropic-ai/sdk`. The live data is passed in the prompt, and the assistant is told not to invent numbers. If no `ANTHROPIC_API_KEY` is set, the chat falls back to the free, keyless Pollinations.ai text API (limited to about 1 reply every 45 seconds per IP).
- **Forecast model**: a ridge-regression model written from scratch, trained in the browser on the 30-day hourly history (PM2.5 lags, wind, humidity, temperature, time of day).
- **Libraries**: Express, dotenv, Leaflet (maps), Chart.js (charts).
- **Data/services**: Open-Meteo / CAMS, NASA FIRMS, OpenStreetMap tiles.
