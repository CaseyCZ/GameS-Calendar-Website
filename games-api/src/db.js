import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { historyValuesEqual, normalizeHistoryValue } from './lib/history.js';

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
export const db = new DatabaseSync(config.dbFile);
db.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS cache (
    cache_key TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cache_expires_idx ON cache(expires_at);

  CREATE TABLE IF NOT EXISTS provider_health (
    provider TEXT PRIMARY KEY,
    ok INTEGER NOT NULL,
    status TEXT,
    detail TEXT,
    checked_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS game_snapshots (
    game_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS change_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_key TEXT NOT NULL,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    source TEXT,
    changed_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS change_history_game_idx ON change_history(game_key, changed_at DESC);

  CREATE TABLE IF NOT EXISTS discovered_games (
    game_id TEXT PRIMARY KEY,
    igdb_id TEXT UNIQUE NOT NULL,
    search_text TEXT NOT NULL,
    payload TEXT NOT NULL,
    discovered_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS discovered_games_search_idx ON discovered_games(search_text);

  CREATE TABLE IF NOT EXISTS catalog_game_state (
    game_key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    payload TEXT NOT NULL,
    source TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    first_seen INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS catalog_game_state_active_idx ON catalog_game_state(active, updated_at DESC);

  CREATE TABLE IF NOT EXISTS app_state (
    state_key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    game_ids TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS push_deliveries (
    endpoint TEXT NOT NULL,
    event_key TEXT NOT NULL,
    sent_at INTEGER NOT NULL,
    PRIMARY KEY(endpoint,event_key)
  );
  CREATE INDEX IF NOT EXISTS push_deliveries_sent_idx ON push_deliveries(sent_at);
`);

const getCacheStmt = db.prepare('SELECT payload, expires_at FROM cache WHERE cache_key = ?');
const putCacheStmt = db.prepare(`
  INSERT INTO cache(cache_key, provider, payload, fetched_at, expires_at)
  VALUES(?,?,?,?,?)
  ON CONFLICT(cache_key) DO UPDATE SET provider=excluded.provider,payload=excluded.payload,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at
`);
const healthStmt = db.prepare(`
  INSERT INTO provider_health(provider,ok,status,detail,checked_at)
  VALUES(?,?,?,?,?)
  ON CONFLICT(provider) DO UPDATE SET ok=excluded.ok,status=excluded.status,detail=excluded.detail,checked_at=excluded.checked_at
`);
const getSnapshotStmt = db.prepare('SELECT payload FROM game_snapshots WHERE game_key = ?');
const putSnapshotStmt = db.prepare(`
  INSERT INTO game_snapshots(game_key,payload,updated_at)
  VALUES(?,?,?)
  ON CONFLICT(game_key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at
`);
const insertChangeStmt = db.prepare('INSERT INTO change_history(game_key,field,old_value,new_value,source,changed_at) VALUES(?,?,?,?,?,?)');
const getDiscoveredStmt = db.prepare('SELECT payload FROM discovered_games WHERE game_id = ? OR igdb_id = ? LIMIT 1');
const putDiscoveredStmt = db.prepare(`
  INSERT INTO discovered_games(game_id,igdb_id,search_text,payload,discovered_at,updated_at)
  VALUES(?,?,?,?,?,?)
  ON CONFLICT(game_id) DO UPDATE SET
    igdb_id=excluded.igdb_id,
    search_text=excluded.search_text,
    payload=excluded.payload,
    updated_at=excluded.updated_at
`);
const getCatalogStateStmt = db.prepare('SELECT title,payload,active FROM catalog_game_state WHERE game_key = ?');
const putCatalogStateStmt = db.prepare(`
  INSERT INTO catalog_game_state(game_key,title,payload,source,active,first_seen,updated_at)
  VALUES(?,?,?,?,1,?,?)
  ON CONFLICT(game_key) DO UPDATE SET
    title=excluded.title,
    payload=excluded.payload,
    source=excluded.source,
    active=1,
    updated_at=excluded.updated_at
`);
const getAppStateStmt = db.prepare('SELECT value FROM app_state WHERE state_key = ?');
const putAppStateStmt = db.prepare(`
  INSERT INTO app_state(state_key,value,updated_at) VALUES(?,?,?)
  ON CONFLICT(state_key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
`);
const putPushSubscriptionStmt = db.prepare(`
  INSERT INTO push_subscriptions(endpoint,payload,game_ids,created_at,updated_at)
  VALUES(?,?,?,?,?)
  ON CONFLICT(endpoint) DO UPDATE SET payload=excluded.payload,game_ids=excluded.game_ids,updated_at=excluded.updated_at
`);
const removePushSubscriptionStmt = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
const hasPushDeliveryStmt = db.prepare('SELECT 1 AS found FROM push_deliveries WHERE endpoint = ? AND event_key = ?');
const putPushDeliveryStmt = db.prepare('INSERT OR IGNORE INTO push_deliveries(endpoint,event_key,sent_at) VALUES(?,?,?)');

export function cacheGet(key, { allowStale = false } = {}) {
  const row = getCacheStmt.get(key);
  if (!row) return null;
  if (!allowStale && row.expires_at < Date.now()) return null;
  try { return JSON.parse(row.payload); }
  catch { return null; }
}

export function cachePut(key, provider, payload, ttlMs) {
  const now = Date.now();
  putCacheStmt.run(key, provider, JSON.stringify(payload), now, now + ttlMs);
  return payload;
}

export function saveHealth(provider, ok, status = '', detail = '') {
  healthStmt.run(provider, ok ? 1 : 0, String(status || ''), String(detail || '').slice(0, 2000), Date.now());
}

export function listHealth() {
  return db.prepare('SELECT provider,ok,status,detail,checked_at FROM provider_health ORDER BY provider').all()
    .map(row => ({ ...row, ok: Boolean(row.ok), checkedAt: new Date(row.checked_at).toISOString() }));
}

export function recordChange(gameKey, field, oldValue, newValue, source) {
  if (historyValuesEqual(field, oldValue, newValue)) return null;
  const normalizedOld = normalizeHistoryValue(field, oldValue);
  const normalizedNew = normalizeHistoryValue(field, newValue);
  const oldText = normalizedOld == null ? null : (typeof normalizedOld === 'string' ? normalizedOld : JSON.stringify(normalizedOld));
  const newText = normalizedNew == null ? null : (typeof normalizedNew === 'string' ? normalizedNew : JSON.stringify(normalizedNew));
  const changedAt = Date.now();
  const info = insertChangeStmt.run(String(gameKey), String(field), oldText, newText, String(source || ''), changedAt);
  return { id: Number(info.lastInsertRowid), gameKey: String(gameKey), field, oldValue: normalizedOld, newValue: normalizedNew, source: String(source || ''), changedAt: new Date(changedAt).toISOString() };
}

const SUBSCRIPTION_PROVIDER = Object.freeze({
  gamePass: 'microsoft',
  gamePassConsole: 'microsoft',
  gamePassPc: 'microsoft',
  cloudGaming: 'microsoft',
  eaPlay: 'microsoft',
  psPlus: 'playstation',
  geforceNow: 'geforceNow'
});

function meaningfulTrackedValue(field, value) {
  const normalized = normalizeHistoryValue(field, value);
  if (!normalized || typeof normalized !== 'object') return false;
  return Object.keys(normalized).length > 0;
}

function lastMeaningfulHistoryValue(gameKey, field, limit = 30) {
  const rows = db.prepare(`
    SELECT old_value,new_value
    FROM change_history
    WHERE game_key = ? AND field = ?
    ORDER BY changed_at DESC
    LIMIT ?
  `).all(String(gameKey), String(field), Math.max(1, Math.min(100, Number(limit) || 30)));
  for (const row of rows) {
    for (const raw of [row.new_value, row.old_value]) {
      const value = safeJson(raw, raw);
      if (meaningfulTrackedValue(field, value)) return normalizeHistoryValue(field, value);
    }
  }
  return null;
}

function mergeSparseTrackedSnapshot(previous, next, observedProviders = new Set(), authoritativePriceRemovals = new Set()) {
  if (!previous) return next;
  const merged = { ...next };

  merged.prices = { ...(previous.prices || {}) };
  for (const [provider, price] of Object.entries(next.prices || {})) {
    if (price) merged.prices[provider] = price;
    else if (!(provider in merged.prices)) merged.prices[provider] = null;
  }
  for (const provider of authoritativePriceRemovals) {
    delete merged.prices[provider];
  }
  merged.providerIds = {
    ...(previous.providerIds || {}),
    ...(next.providerIds || {})
  };
  merged.storeUrls = {
    ...(previous.storeUrls || {}),
    ...(next.storeUrls || {})
  };

  const subscriptions = { ...(previous.subscriptions || {}) };
  const nextSubscriptions = next.subscriptions || {};
  for (const [key, provider] of Object.entries(SUBSCRIPTION_PROVIDER)) {
    if (!observedProviders.has(provider)) continue;
    if (nextSubscriptions[key]) subscriptions[key] = true;
    else delete subscriptions[key];
  }
  for (const [key, enabled] of Object.entries(nextSubscriptions)) {
    if (enabled) subscriptions[key] = true;
  }
  merged.subscriptions = normalizeHistoryValue('subscriptions', subscriptions);

  if (!observedProviders.has('steam') && previous.earlyAccess != null) {
    merged.earlyAccess = previous.earlyAccess;
  }

  return merged;
}

function trackedSnapshot(payload = {}) {
  const steam = payload.providers?.steam || null;
  const raw = {
    title: payload.title || '',
    releaseDates: payload.releaseDates || [],
    subscriptions: payload.subscriptions || {},
    prices: Object.fromEntries(Object.entries(payload.providers || {}).map(([provider, item]) => [provider, item?.price || null])),
    providerIds: Object.fromEntries(Object.entries(payload.providers || {}).map(([provider, item]) => [provider, item?.providerId || null])),
    storeUrls: Object.fromEntries(Object.entries(payload.providers || {}).map(([provider, item]) => [provider, item?.storeUrl || '']).filter(([, value]) => Boolean(value))),
    earlyAccess: steam ? Boolean(steam.earlyAccess) : null
  };
  return Object.fromEntries(Object.entries(raw).map(([field,value]) => [field, normalizeHistoryValue(field, value)]));
}

export function saveGameSnapshot(gameKey, payload, source = 'enrich') {
  if (!gameKey || !payload) return [];
  const observedProviders = new Set(Object.keys(payload.providers || {}));
  const authoritativePriceRemovals = new Set(
    Object.entries(payload.providers || {})
      .filter(([, item]) => item?.rawHints?.priceSuppressed === true)
      .map(([provider]) => provider)
  );
  const next = trackedSnapshot(payload);
  let previous = null;
  const row = getSnapshotStmt.get(String(gameKey));
  if (row?.payload) {
    try {
      const rawPrevious = JSON.parse(row.payload);
      previous = Object.fromEntries(Object.entries(rawPrevious || {}).map(([field,value]) => [field, normalizeHistoryValue(field, value)]));
    } catch {}
  }

  if (previous) {
    if (!Object.keys(previous.prices || {}).length) {
      previous.prices = lastMeaningfulHistoryValue(gameKey, 'prices') || {};
    }
    if (!Object.keys(previous.providerIds || {}).length) {
      previous.providerIds = lastMeaningfulHistoryValue(gameKey, 'providerIds') || {};
    }
  }

  const stableNext = mergeSparseTrackedSnapshot(previous, next, observedProviders, authoritativePriceRemovals);
  const changes = [];
  if (previous) {
    for (const field of ['title', 'releaseDates', 'subscriptions', 'prices', 'providerIds', 'earlyAccess']) {
      const change = recordChange(gameKey, field, previous[field], stableNext[field], source);
      if (change) changes.push(change);
    }
  }
  putSnapshotStmt.run(String(gameKey), JSON.stringify(stableNext), Date.now());
  return changes;
}

export function gameSnapshot(gameKey) {
  if (!gameKey) return null;
  const row = getSnapshotStmt.get(String(gameKey));
  if (!row?.payload) return null;
  try { return JSON.parse(row.payload); }
  catch { return null; }
}

function suppressUnconfirmedPriceRemoval(oldValue, newValue) {
  const oldPrices = normalizeHistoryValue('prices', oldValue) || {};
  const newPrices = normalizeHistoryValue('prices', newValue) || {};
  return {
    oldValue: oldPrices,
    newValue: { ...oldPrices, ...newPrices }
  };
}

function stableHistoryItem(item) {
  if (item?.field !== 'prices') return item;
  const stable = suppressUnconfirmedPriceRemoval(item.oldValue, item.newValue);
  return { ...item, ...stable };
}

export function historyForGame(gameKey, limit = 100) {
  const take = Math.max(1, Math.min(500, Number(limit) || 100));
  const rows = db.prepare(`
    SELECT id,game_key,field,old_value,new_value,source,changed_at
    FROM change_history WHERE game_key = ? ORDER BY changed_at DESC LIMIT ?
  `).all(String(gameKey), Math.min(500, take * 4));

  return rows.map(row => {
    const oldValue = safeJson(row.old_value, row.old_value);
    const newValue = safeJson(row.new_value, row.new_value);
    return stableHistoryItem({
      id: Number(row.id),
      gameKey: row.game_key,
      field: row.field,
      oldValue,
      newValue,
      source: row.source,
      changedAt: new Date(row.changed_at).toISOString()
    });
  }).filter(item => !historyValuesEqual(item.field, item.oldValue, item.newValue)).slice(0, take);
}

function normalizedReleaseDates(game = {}) {
  return (game.releases || []).map(release => ({
    day: release.date || release.day || null,
    window: String(release.window || release.label || '').trim(),
    precision: release.precision || (release.date || release.day ? 'day' : 'unknown'),
    platforms: (release.platforms || [])
      .map(platform => typeof platform === 'string' ? platform : (platform?.abbreviation || platform?.name || ''))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'en'))
  })).sort((a, b) =>
    String(a.day || a.window).localeCompare(String(b.day || b.window))
    || a.platforms.join('|').localeCompare(b.platforms.join('|'))
  );
}

function catalogSnapshot(game = {}) {
  return {
    id: String(game.id || game.slug || ''),
    igdbId: String(game.igdbId || ''),
    name: String(game.name || ''),
    cover: String(game.cover || ''),
    releases: normalizedReleaseDates(game)
  };
}

function safeJson(value, fallback = null) {
  try { return JSON.parse(value); }
  catch { return fallback; }
}

export function syncCatalogGames(games, { fingerprint = '', source = 'catalog' } = {}) {
  if (!Array.isArray(games)) return { baseline: false, added: 0, changed: 0 };
  const previousFingerprint = getAppStateStmt.get('catalog_fingerprint')?.value || '';
  if (fingerprint && previousFingerprint === fingerprint) return { baseline: false, added: 0, changed: 0, skipped: true };

  const baseline = Number(db.prepare('SELECT COUNT(*) AS count FROM catalog_game_state').get()?.count || 0) === 0;
  const previousActive = new Map(db.prepare('SELECT game_key,title,payload FROM catalog_game_state WHERE active = 1').all()
    .map(row => [String(row.game_key), row]));
  const now = Date.now();
  let added = 0;
  let changed = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE catalog_game_state SET active = 0').run();
    for (const game of games) {
      const snapshot = catalogSnapshot(game);
      if (!snapshot.id || !snapshot.name) continue;
      const previous = getCatalogStateStmt.get(snapshot.id);
      const previousPayload = safeJson(previous?.payload, {});
      if (!previous) {
        added += 1;
        if (!baseline) recordChange(snapshot.id, 'gameAdded', null, snapshot, source);
      } else if (JSON.stringify(previousPayload.releases || []) !== JSON.stringify(snapshot.releases)) {
        changed += 1;
        recordChange(snapshot.id, 'releaseDates', previousPayload.releases || [], snapshot.releases, source);
      }
      putCatalogStateStmt.run(snapshot.id, snapshot.name, JSON.stringify(snapshot), source, now, now);
      previousActive.delete(snapshot.id);
    }
    if (!baseline) {
      for (const [gameKey, previous] of previousActive) {
        const payload = safeJson(previous.payload, { id: gameKey, name: previous.title });
        recordChange(gameKey, 'gameRemoved', payload, null, source);
      }
    }
    putAppStateStmt.run('catalog_fingerprint', String(fingerprint || now), now);
    if (!getAppStateStmt.get('history_started_at')) putAppStateStmt.run('history_started_at', String(now), now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { baseline, added, changed, removed: previousActive.size };
}

function hydrateChange(row) {
  const payload = safeJson(row.catalog_payload, null) || safeJson(row.discovered_payload, null);
  return {
    id: Number(row.id),
    gameKey: row.game_key,
    game: payload ? { id: payload.id || row.game_key, name: payload.name || row.title || row.game_key, cover: payload.cover || '' } : { id: row.game_key, name: row.title || row.game_key, cover: '' },
    field: row.field,
    oldValue: safeJson(row.old_value, row.old_value),
    newValue: safeJson(row.new_value, row.new_value),
    source: row.source,
    changedAt: new Date(row.changed_at).toISOString()
  };
}

export function listRecentChanges({ limit = 100, since = 0, type = 'all', gameKeys = [] } = {}) {
  const take = Math.max(1, Math.min(500, Number(limit) || 100));
  const fields = type === 'new'
    ? ['gameAdded']
    : type === 'date'
      ? ['releaseDates']
      : type === 'price'
        ? ['prices']
        : type === 'subscription'
          ? ['subscriptions']
          : type === 'early'
            ? ['earlyAccess']
            : ['gameAdded', 'releaseDates', 'gameRemoved', 'prices', 'subscriptions', 'earlyAccess'];
  const keys = [...new Set((gameKeys || []).map(String).filter(Boolean))].slice(0, 500);
  const clauses = [`h.field IN (${fields.map(() => '?').join(',')})`, 'h.changed_at >= ?'];
  const params = [...fields, Math.max(0, Number(since) || 0)];
  if (keys.length) {
    clauses.push(`h.game_key IN (${keys.map(() => '?').join(',')})`);
    params.push(...keys);
  }
  const rows = db.prepare(`
    SELECT h.*,c.title,c.payload AS catalog_payload,d.payload AS discovered_payload
    FROM change_history h
    LEFT JOIN catalog_game_state c ON c.game_key = h.game_key
    LEFT JOIN discovered_games d ON d.game_id = h.game_key
    WHERE ${clauses.join(' AND ')}
    ORDER BY h.changed_at DESC,h.id DESC LIMIT ?
  `).all(...params, take);
  return rows.map(hydrateChange)
    .map(stableHistoryItem)
    .filter(item => !historyValuesEqual(item.field, item.oldValue, item.newValue));
}

export function latestChangeId() {
  return Number(db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM change_history').get()?.id || 0);
}

export function historyStartedAt() {
  const value = Number(getAppStateStmt.get('history_started_at')?.value || 0);
  return value ? new Date(value).toISOString() : null;
}

export function savePushSubscription(subscription, gameIds = []) {
  const endpoint = String(subscription?.endpoint || '').trim();
  if (!endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) throw new Error('Invalid push subscription');
  const ids = [...new Set((gameIds || []).map(String).filter(Boolean))].slice(0, 500);
  const now = Date.now();
  putPushSubscriptionStmt.run(endpoint, JSON.stringify(subscription), JSON.stringify(ids), now, now);
  return { endpoint, gameCount: ids.length };
}

export function removePushSubscription(endpoint) {
  const value = String(endpoint || '').trim();
  if (!value) return false;
  removePushSubscriptionStmt.run(value);
  db.prepare('DELETE FROM push_deliveries WHERE endpoint = ?').run(value);
  return true;
}

export function listPushSubscriptions() {
  return db.prepare('SELECT endpoint,payload,game_ids,created_at,updated_at FROM push_subscriptions ORDER BY updated_at').all().map(row => ({
    endpoint: row.endpoint,
    subscription: safeJson(row.payload, null),
    gameIds: safeJson(row.game_ids, []),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  })).filter(row => row.subscription && Array.isArray(row.gameIds));
}

export function wasPushDelivered(endpoint, eventKey) {
  return Boolean(hasPushDeliveryStmt.get(String(endpoint), String(eventKey))?.found);
}

export function markPushDelivered(endpoint, eventKeys) {
  const now = Date.now();
  for (const eventKey of eventKeys || []) putPushDeliveryStmt.run(String(endpoint), String(eventKey), now);
}

export function prunePushDeliveries(before = Date.now() - 180 * 86_400_000) {
  return Number(db.prepare('DELETE FROM push_deliveries WHERE sent_at < ?').run(Number(before)).changes || 0);
}


export function saveDiscoveredGame(game) {
  if (!game?.id || !game?.igdbId) return null;
  const now = Date.now();
  const previousRow = getDiscoveredStmt.get(String(game.id), String(game.igdbId));
  const previous = safeJson(previousRow?.payload, null);
  const searchText = [game.name, ...(game.aliases || []), ...(game.series || [])]
    .join(' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  putDiscoveredStmt.run(String(game.id), String(game.igdbId), searchText, JSON.stringify(game), now, now);
  const nextSnapshot = catalogSnapshot(game);
  if (!previous) recordChange(String(game.id), 'gameAdded', null, nextSnapshot, 'igdb-search');
  else {
    const previousDates = normalizedReleaseDates(previous);
    if (JSON.stringify(previousDates) !== JSON.stringify(nextSnapshot.releases)) {
      recordChange(String(game.id), 'releaseDates', previousDates, nextSnapshot.releases, 'igdb-search');
    }
  }
  return game;
}

export function getDiscoveredGame(id) {
  const value = String(id || '').replace(/^igdb-/, '');
  const row = getDiscoveredStmt.get(String(id || ''), value);
  if (!row?.payload) return null;
  try { return JSON.parse(row.payload); }
  catch { return null; }
}

export function searchDiscoveredGames(query, limit = 8) {
  const words = String(query || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];
  const take = Math.max(1, Math.min(500, Number(limit) || 100));
  const where = words.map(() => 'search_text LIKE ?').join(' AND ');
  const rows = db.prepare(`SELECT payload FROM discovered_games WHERE ${where} ORDER BY updated_at DESC LIMIT ?`)
    .all(...words.map(word => `%${word}%`), take);
  const out = [];
  for (const row of rows) {
    try {
      const game = JSON.parse(row.payload);
      const haystack = [game.name, ...(game.aliases || []), ...(game.series || [])]
        .join(' ')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ');
      if (words.every(word => haystack.includes(word))) out.push(game);
    } catch {}
    if (out.length >= take) break;
  }
  return out;
}
