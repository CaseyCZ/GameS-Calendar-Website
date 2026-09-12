import path from 'node:path';
import { readFileSync } from 'node:fs';

const num = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = String(packageJson.version || '0.0.0');

export const config = Object.freeze({
  version,
  host: String(process.env.HOST || process.env.GAMES_API_HOST || '127.0.0.1').trim() || '127.0.0.1',
  port: num(process.env.PORT, 8787),
  dbFile: path.resolve(process.env.GAMES_API_DB || './data/games-api.sqlite'),
  market: String(process.env.GAMES_API_MARKET || 'CZ').toUpperCase(),
  language: String(process.env.GAMES_API_LANGUAGE || 'cs-cz').toLowerCase(),
  psLocale: String(process.env.GAMES_API_PS_LOCALE || 'en-cz').toLowerCase(),
  nintendoRegion: String(process.env.GAMES_API_NINTENDO_REGION || 'us').toLowerCase(),
  nintendoCountry: String(process.env.GAMES_API_NINTENDO_COUNTRY || process.env.GAMES_API_MARKET || 'CZ').toUpperCase(),
  nintendoLanguage: String(process.env.GAMES_API_NINTENDO_LANGUAGE || 'en').toLowerCase(),
  gfnCountry: String(process.env.GAMES_API_GFN_COUNTRY || 'CZ').toUpperCase(),
  gfnLanguage: String(process.env.GAMES_API_GFN_LANGUAGE || 'en_US'),
  steamWebApiKey: String(process.env.STEAM_WEB_API_KEY || '').trim(),
  igdbClientId: String(process.env.IGDB_CLIENT_ID || '').trim(),
  igdbClientSecret: String(process.env.IGDB_CLIENT_SECRET || '').trim(),
  igdbConfigured: Boolean(String(process.env.IGDB_CLIENT_ID || '').trim() && String(process.env.IGDB_CLIENT_SECRET || '').trim()),
  rateLimitPerMinute: Math.max(30, num(process.env.GAMES_API_RATE_LIMIT_PER_MINUTE, 180)),
  userAgent: `GameS-Calendar-API/${version} (+https://github.com/CaseyCZ/GameS-Calendar-Website)`,
  ttl: Object.freeze({
    search: 30 * 60_000,
    product: 6 * 60 * 60_000,
    media: 24 * 60 * 60_000,
    gamePass: 60 * 60_000,
    gfn: 60 * 60_000,
    nintendo: 12 * 60 * 60_000,
    igdb: 24 * 60 * 60_000,
    health: 15 * 60_000
  })
});
