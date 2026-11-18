// Small fetch wrappers with timeouts. Responses served from the service worker
// cache (offline fallback) are flagged with `_fromCache = true`.

const DEFAULT_TIMEOUT = 15000;

export class ApiError extends Error {
  constructor(message, { status = 0, data = null, network = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.network = network;
  }
}

async function request(path, { method = 'GET', body, timeout = DEFAULT_TIMEOUT } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(path, {
      method,
      signal: ctrl.signal,
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    clearTimeout(timer);
    const timedOut = err && err.name === 'AbortError';
    throw new ApiError(timedOut ? 'timeout' : 'network', { network: true });
  }
  clearTimeout(timer);

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }

  if (!res.ok) {
    throw new ApiError((data && (data.message || data.error)) || `HTTP ${res.status}`, {
      status: res.status,
      data,
      network: res.status === 503 && data && data.error === 'offline',
    });
  }
  if (data && typeof data === 'object' && res.headers.get('X-SW-Cache') === '1') {
    data._fromCache = true;
  }
  return data;
}

const q = (city) => `?city=${encodeURIComponent(city)}`;

export const getCities = () => request('/api/cities');
export const getWeather = (city = 'lahore') => request(`/api/weather${q(city)}`);
export const getHistory = (city = 'lahore') => request(`/api/history${q(city)}`, { timeout: 25000 });
export const getFires = () => request('/api/fires', { timeout: 120000 });
export const getReports = () => request('/api/reports');
export const getHealth = () => request('/api/health', { timeout: 8000 });
export const postReport = (report) => request('/api/reports', { method: 'POST', body: report });
export const postChat = (payload) => request('/api/chat', { method: 'POST', body: payload, timeout: 60000 });
