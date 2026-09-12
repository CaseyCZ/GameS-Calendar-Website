import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

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
  const oldText = oldValue == null ? null : (typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue));
  const newText = newValue == null ? null : (typeof newValue === 'string' ? newValue : JSON.stringify(newValue));
  if (oldText === newText) return null;
  const changedAt = Date.now();
  const info = insertChangeStmt.run(String(gameKey), String(field), oldText, newText, String(source || ''), changedAt);
  return { id: Number(info.lastInsertRowid), gameKey: String(gameKey), field, oldValue, newValue, source: String(source || ''), changedAt: new Date(changedAt).toISOString() };
}

function trackedSnapshot(payload = {}) {
  return {
    title: payload.title || '',
    releaseDates: payload.releaseDates || {},
    subscriptions: payload.subscriptions || {},
    prices: Object.fromEntries(Object.entries(payload.providers || {}).map(([provider, item]) => [provider, item?.price || null])),
    providerIds: Object.fromEntries(Object.entries(payload.providers || {}).map(([provider, item]) => [provider, item?.providerId || null]))
  };
}

export function saveGameSnapshot(gameKey, payload, source = 'enrich') {
  if (!gameKey || !payload) return [];
  const next = trackedSnapshot(payload);
  let previous = null;
  const row = getSnapshotStmt.get(String(gameKey));
  if (row?.payload) {
    try { previous = JSON.parse(row.payload); } catch {}
  }
  const changes = [];
  if (previous) {
    for (const field of ['title', 'releaseDates', 'subscriptions', 'prices', 'providerIds']) {
      const change = recordChange(gameKey, field, previous[field], next[field], source);
      if (change) changes.push(change);
    }
  }
  putSnapshotStmt.run(String(gameKey), JSON.stringify(next), Date.now());
  return changes;
}

export function historyForGame(gameKey, limit = 100) {
  return db.prepare(`
    SELECT id,game_key,field,old_value,new_value,source,changed_at
    FROM change_history WHERE game_key = ? ORDER BY changed_at DESC LIMIT ?
  `).all(String(gameKey), Math.max(1, Math.min(500, Number(limit) || 100))).map(row => ({
    id: Number(row.id),
    gameKey: row.game_key,
    field: row.field,
    oldValue: row.old_value,
    newValue: row.new_value,
    source: row.source,
    changedAt: new Date(row.changed_at).toISOString()
  }));
}
