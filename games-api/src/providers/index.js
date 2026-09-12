import { config } from '../config.js';
import { microsoftProvider } from './microsoft.js';
import { steamProvider } from './steam.js';
import { playstationProvider } from './playstation.js';
import { nintendoProvider } from './nintendo.js';
import { geforceNowProvider } from './geforce-now.js';
import { igdbProvider } from './igdb.js';

export const providers = Object.freeze({
  ...(config.igdbConfigured ? { igdb: igdbProvider } : {}),
  microsoft: microsoftProvider,
  steam: steamProvider,
  playstation: playstationProvider,
  nintendo: nintendoProvider,
  geforceNow: geforceNowProvider
});

export function providerList(names) {
  if (!names) return Object.values(providers);
  const requested = String(names).split(',').map(v => v.trim()).filter(Boolean);
  return requested.map(name => providers[name]).filter(Boolean);
}
