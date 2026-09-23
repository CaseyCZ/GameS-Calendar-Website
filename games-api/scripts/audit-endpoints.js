import { saveHealth } from '../src/db.js';
import { providers } from '../src/providers/index.js';
import { normalizeTitle, storefrontTitleScore, titleScore } from '../src/lib/normalize.js';
import { readFile } from 'node:fs/promises';

let failed = 0;
for (const provider of Object.values(providers)) {
  const started = Date.now();
  try {
    const result = await provider.health();
    const ok = result?.ok !== false;
    if (!ok) failed += 1;
    saveHealth(provider.name, ok, ok ? 'ok' : 'failed', JSON.stringify(result));
    console.log(`${ok ? '✅' : '❌'} ${provider.name} (${Date.now() - started} ms)`, result);
  } catch (error) {
    failed += 1;
    saveHealth(provider.name, false, 'error', error?.message || String(error));
    console.error(`❌ ${provider.name} (${Date.now() - started} ms): ${error?.message || error}`);
  }
}

if (failed) {
  console.error(`\n${failed} provider(s) failed health checks.`);
  process.exitCode = 1;
} else {
  console.log('\nAll provider health checks passed.');
}

try {
  const query = 'Gears of War: E-Day';
  const expectedId = '9N4PT8HGCDHQ';
  const item = await providers.microsoft.product(expectedId, { force: true });
  const price = Number(item?.price?.current);
  const hasPrice = item?.price?.isFree === true || (Number.isFinite(price) && price > 0);
  const hasGamePass = Boolean(item?.subscriptions?.gamePass);
  const hasXboxUrl = /^https:\/\/www\.xbox\.com\//i.test(String(item?.storeUrl || ''));
  const score = item ? titleScore(query, item.title) : 0;
  const exactId = String(item?.providerId || '').toUpperCase() === expectedId;
  const ok = Boolean(item && exactId && score >= 0.8 && hasXboxUrl && (hasPrice || hasGamePass));
  console.log(`${ok ? '✅' : '❌'} microsoft E-Day exact product probe`, {
    providerId: item?.providerId || null,
    title: item?.title || null,
    storeUrl: item?.storeUrl || null,
    price: item?.price || null,
    gamePass: hasGamePass,
    gamePassComingSoon: Boolean(item?.rawHints?.xboxGamePassComingSoon),
    offers: item?.rawHints?.xboxEditionCount || 0,
    titleScore: score
  });
  if (!ok) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ microsoft E-Day exact product probe: ${error?.message || error}`);
}

try {
  const fallback = await providers.microsoft.search('Gears of War: E-Day', { force: true, limit: 5 });
  const primary = fallback[0] || null;
  const primaryTitle = String(primary?.title || '');
  const primaryScore = primary ? titleScore('Gears of War: E-Day', primaryTitle) : 0;
  const unsafePrimary = /upgrade|bonus|points?|coins?|credits?|dlc|add[- ]?on/i.test(primaryTitle);
  const ok = !primary || (primaryScore >= 0.55 && !unsafePrimary);
  console.log(`${ok ? '✅' : '❌'} microsoft E-Day fallback safety probe`, {
    count: fallback.length,
    primary: primaryTitle || null,
    primaryScore,
    titles: fallback.map(item => item?.title || null).slice(0, 5)
  });
  if (!ok) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ microsoft E-Day fallback safety probe: ${error?.message || error}`);
}


try {
  const query = 'EA Sports FC 27';
  const microsoft = (await providers.microsoft.search(query, { force:true, limit:6 }))[0] || null;
  const playstation = await providers.playstation.concept('10017332', { force:true });
  const nintendo = await providers.nintendo.search(query, { force:true, limit:6 });
  const exactNintendo = nintendo.filter(item => storefrontTitleScore(query, item?.title) >= 0.95);

  const msCurrent = Number(microsoft?.price?.current);
  const msRegular = Number(microsoft?.price?.regular);
  const msOk = String(microsoft?.providerId || '').toUpperCase() === '9PH4M2J4680F'
    && Number.isFinite(msCurrent) && msCurrent > 0
    && Number.isFinite(msRegular) && Math.abs(msRegular - 1899) < 0.01
    && msCurrent <= msRegular
    && !/ultimate|deluxe|premium/i.test(String(microsoft?.title || ''));

  const psOk = /STANDARD|BASE/i.test(String(playstation?.rawHints?.priceProductId || ''))
    && Math.abs(Number(playstation?.price?.current) - 1899) < 0.01;

  const nintendoBase = exactNintendo.filter(item => /^700100/.test(String(item?.providerId || '')));
  const nintendoBundle = exactNintendo.filter(item => /^700700/.test(String(item?.providerId || '')));
  const ninOk = nintendoBase.length >= 1 && nintendoBundle.length === 0
    && nintendoBase.every(item => item.releaseDate === '2026-09-25');

  const ok = msOk && psOk && ninOk;
  console.log(`${ok ? '✅' : '❌'} FC 27 base-edition pricing regression`, {
    microsoft:{
      providerId:microsoft?.providerId || null,
      title:microsoft?.title || null,
      price:microsoft?.price || null,
      storeUrl:microsoft?.storeUrl || null
    },
    playstation:{
      priceProductId:playstation?.rawHints?.priceProductId || null,
      price:playstation?.price || null
    },
    nintendo:exactNintendo.map(item => ({
      providerId:item?.providerId || null,
      releaseDate:item?.releaseDate || null,
      price:item?.price || null
    }))
  });
  if (!ok) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ FC 27 base-edition pricing regression: ${error?.message || error}`);
}


try {
  const query = 'EA SPORTS FC 27';
  const catalog = JSON.parse(await readFile('../games-index.json', 'utf8'));
  const game = (catalog?.games || []).find(item => normalizeTitle(item?.name) === normalizeTitle(query))
    || (catalog?.games || []).find(item => normalizeTitle(item?.name).includes('ea sports fc 27'));
  if (!game) throw new Error('FC 27 not found in games-index.json');

  const liveBase = String(process.env.GAMES_LIVE_API || 'https://130.61.49.108/games-api').replace(/\/+$/,'');
  const response = await fetch(`${liveBase}/enrich`, {
    method:'POST',
    headers:{ 'content-type':'application/json', accept:'application/json' },
    body:JSON.stringify({
      game:{
        id:String(game.id || ''),
        igdbId:String(game.igdbId || ''),
        title:String(game.name || query)
      },
      providers:'igdb,microsoft,playstation,nintendo'
    })
  });
  const rawText = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${rawText.slice(0,500)}`);
  const payload = JSON.parse(rawText);
  const result = payload?.results?.[0] || {};
  const ms = result?.providers?.microsoft || null;
  const ps = result?.providers?.playstation || null;
  const nin = result?.providers?.nintendo || null;

  const msOk = Boolean(
    ms
    && !/ultimate|deluxe|premium/i.test(String(ms.title || ''))
    && Number(ms.price?.current || 0) > 0
  );
  const psOk = Boolean(
    ps
    && !/ultimate|deluxe|premium/i.test(String(ps.title || ''))
    && /STANDARD|BASE/i.test(String(ps.rawHints?.priceProductId || ''))
  );
  const ninOk = Boolean(
    nin
    && !/ultimate|deluxe|premium/i.test(String(nin.title || ''))
    && !/^700700/.test(String(nin.providerId || ''))
  );
  const ok = msOk && psOk && ninOk;

  console.log(`${ok ? '✅' : '❌'} FC 27 production enrich probe`);
  console.log(JSON.stringify({
    game:{ id:game.id || null, igdbId:game.igdbId || null, name:game.name || null },
    identity:result?.identity || null,
    matchedProviders:result?.matchedProviders || [],
    microsoft:ms && {
      providerId:ms.providerId || null,
      title:ms.title || null,
      price:ms.price || null,
      storeUrl:ms.storeUrl || null
    },
    playstation:ps && {
      providerId:ps.providerId || null,
      title:ps.title || null,
      priceProductId:ps.rawHints?.priceProductId || null,
      price:ps.price || null,
      storeUrl:ps.storeUrl || null
    },
    nintendo:nin && {
      providerId:nin.providerId || null,
      title:nin.title || null,
      price:nin.price || null,
      storeUrl:nin.storeUrl || null
    },
    checks:{ msOk, psOk, ninOk }
  }, null, 2));

  if (!ok) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ FC 27 production enrich probe: ${error?.stack || error?.message || error}`);
}
