import { saveHealth } from '../src/db.js';
import { providers } from '../src/providers/index.js';
import { storefrontTitleScore, titleScore } from '../src/lib/normalize.js';

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
