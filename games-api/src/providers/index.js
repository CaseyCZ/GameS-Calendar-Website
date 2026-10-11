import { config } from '../config.js';
import { saveHealth } from '../db.js';
import { microsoftProvider } from './microsoft.js';
import { steamProvider } from './steam.js';
import { epicProvider } from './epic.js';
import { playstationProvider } from './playstation.js';
import { nintendoProvider } from './nintendo.js';
import { geforceNowProvider } from './geforce-now.js';
import { igdbProvider } from './igdb.js';

export const providers = Object.freeze({
  ...(config.igdbConfigured ? { igdb: igdbProvider } : {}),
  microsoft: microsoftProvider,
  steam: steamProvider,
  epic: epicProvider,
  playstation: playstationProvider,
  nintendo: nintendoProvider,
  geforceNow: geforceNowProvider
});

let healthRefreshPromise = null;

export function refreshProviderHealth() {
  if (healthRefreshPromise) return healthRefreshPromise;

  healthRefreshPromise = Promise.all(Object.values(providers).map(async provider => {
    const started = Date.now();
    try {
      const result = await provider.health();
      const ok = result?.ok !== false;
      saveHealth(
        provider.name,
        ok,
        ok ? 'ok' : 'failed',
        JSON.stringify({ ...result, durationMs: Date.now() - started })
      );
      return { provider: provider.name, ok };
    } catch (error) {
      saveHealth(provider.name, false, 'error', error?.message || String(error));
      return { provider: provider.name, ok: false };
    }
  })).finally(() => {
    healthRefreshPromise = null;
  });

  return healthRefreshPromise;
}

const isServerRuntime = /[\\/]src[\\/]server\.js$/.test(String(process.argv[1] || ''));
if (isServerRuntime) {
  const firstHealthRefresh = setTimeout(() => {
    refreshProviderHealth().catch(() => null);
  }, 5_000);
  firstHealthRefresh.unref?.();

  const providerHealthTimer = setInterval(() => {
    refreshProviderHealth().catch(() => null);
  }, 60 * 60_000);
  providerHealthTimer.unref?.();
}

export function providerList(names) {
  if (!names) return Object.values(providers);
  const requested = String(names).split(',').map(v => v.trim()).filter(Boolean);
  return requested.map(name => providers[name]).filter(Boolean);
}
