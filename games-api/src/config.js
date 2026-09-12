import path from 'node:path';

const num = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const config = Object.freeze({
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
  rateLimitPerMinute: Math.max(30, num(process.env.GAMES_API_RATE_LIMIT_PER_MINUTE, 180)),
  userAgent: 'GameS-Calendar-API/0.1 (+https://github.com/CaseyCZ/GameS-Calendar-Website)',
  ttl: Object.freeze({
    search: 30 * 60_000,
    product: 6 * 60 * 60_000,
    media: 24 * 60 * 60_000,
    gamePass: 60 * 60_000,
    gfn: 60 * 60_000,
    nintendo: 12 * 60 * 60_000,
    health: 15 * 60_000
  })
});
