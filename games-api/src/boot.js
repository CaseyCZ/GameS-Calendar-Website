import fs from 'node:fs';
import path from 'node:path';
import { readCatalog, replaceCatalog } from './db.js';

const runtimeFile = path.resolve(process.env.GAMES_RUNTIME_CATALOG_FILE || './data/catalog-runtime.json');
const bootstrapCandidates = [
  process.env.GAMES_BOOTSTRAP_CATALOG_FILE,
  '/var/www/games-calendar/games.json',
  new URL('../../games.json', import.meta.url)
].filter(Boolean);

fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });

function validCatalog(payload) {
  return Array.isArray(payload) || Array.isArray(payload?.games);
}

function writeRuntime(payload) {
  const tmp = `${runtimeFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, runtimeFile);
}

let catalog = readCatalog();

if (!catalog?.games?.length) {
  for (const file of bootstrapCandidates) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const payload = JSON.parse(raw);
      if (!validCatalog(payload)) continue;
      const stat = fs.statSync(file);
      replaceCatalog(payload, { source: `bootstrap:${String(file)}`, sourceMtime: stat.mtimeMs });
      catalog = readCatalog();
      console.log(`Catalog bootstrapped into SQLite from ${String(file)} (${catalog?.games?.length || 0} games)`);
      break;
    } catch {}
  }
}

if (catalog?.games?.length) {
  writeRuntime(catalog);
  process.env.GAMES_CATALOG_FILE = runtimeFile;
  console.log(`Catalog source: SQLite (${catalog.games.length} games) -> ${runtimeFile}`);
} else if (!process.env.GAMES_CATALOG_FILE) {
  console.warn('SQLite catalog is empty; server will use its legacy catalog fallbacks.');
}

await import('./server.js');
