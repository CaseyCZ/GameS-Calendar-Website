const IS_GITHUB_PAGES = Boolean(globalThis.location?.hostname?.endsWith('.github.io'));

export const API_ROOTS = IS_GITHUB_PAGES
  ? ['https://130.61.49.108/games-api', 'https://130.61.49.108:8443/games-api']
  : ['/games-api'];

export function apiUrl(path = '', root = API_ROOTS[0]) {
  const suffix = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  return `${String(root || '').replace(/\/$/, '')}${suffix}`;
}

export async function fetchApi(path, options = {}, { retries = 2 } = {}) {
  let lastError = null;
  for (const root of API_ROOTS) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(apiUrl(path, root), options);
        if (response.ok) return response;
        if (![502, 503, 504].includes(response.status) || attempt === retries) {
          lastError = new Error(`API HTTP ${response.status}`);
          break;
        }
      } catch (error) {
        lastError = error;
        if (attempt === retries) break;
      }
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError || new Error('GameS API is not available');
}

export async function fetchApiJson(path, options = {}, retryOptions) {
  const response = await fetchApi(path, {
    ...options,
    headers: { Accept:'application/json', ...(options.headers || {}) }
  }, retryOptions);
  return response.json();
}
