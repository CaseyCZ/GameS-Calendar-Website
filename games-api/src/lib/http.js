import { config } from '../config.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function retryAfterMs(response) {
  const raw = String(response?.headers?.get?.('retry-after') || '').trim();
  if (!raw) return 0;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0;
}

function retryDelayMs(response, attempt) {
  if (response?.status === 429) {
    const serverDelay = retryAfterMs(response);
    if (serverDelay > 0) return Math.min(10_000, Math.max(1_000, serverDelay));
    return [2_000, 5_000, 10_000][attempt - 1] || 10_000;
  }
  return Math.min(2500, 350 * 2 ** (attempt - 1));
}

export async function fetchResponse(url, options = {}) {
  const {
    timeoutMs = 12_000,
    attempts = 3,
    headers = {},
    ...init
  } = options;

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          'user-agent': config.userAgent,
          accept: '*/*',
          ...headers
        }
      });
      if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
        await response.arrayBuffer().catch(() => null);
        await sleep(retryDelayMs(response, attempt));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) throw error;
      await sleep(Math.min(2500, 350 * 2 ** (attempt - 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`Request failed: ${url}`);
}

export async function fetchJson(url, options = {}) {
  const response = await fetchResponse(url, {
    ...options,
    headers: { accept: 'application/json,text/plain;q=.9,*/*;q=.5', ...(options.headers || {}) }
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 220)}`);
    error.status = response.status;
    error.retryAfterMs = retryAfterMs(response);
    throw error;
  }
  try { return JSON.parse(text); }
  catch { throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 220)}`); }
}

export async function fetchText(url, options = {}) {
  const response = await fetchResponse(url, options);
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 220)}`);
    error.status = response.status;
    error.retryAfterMs = retryAfterMs(response);
    throw error;
  }
  return text;
}
