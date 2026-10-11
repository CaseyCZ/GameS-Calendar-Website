import { config } from '../config.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
        await sleep(Math.min(2500, 350 * 2 ** (attempt - 1)));
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
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 220)}`);
  try { return JSON.parse(text); }
  catch { throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 220)}`); }
}

export async function fetchText(url, options = {}) {
  const response = await fetchResponse(url, options);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 220)}`);
  return text;
}
