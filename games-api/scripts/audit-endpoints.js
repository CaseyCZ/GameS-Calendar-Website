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
  console.error(`\n${failed} provider(s) failed health checks so far.`);
} else {
  console.log('\nAll provider health checks passed.');
}


try {
  const payload = await providers.playstation.catalog('psPlus', { force: true, size: 40, offset: 0 });
  const candidates = [];
  const seen = new Set();
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value)) {
      const id = String(value.productId || value.conceptId || value.id || '').trim();
      const title = String(value.name || value.title || value.productName || value.conceptName || '').trim();
      if (id && title && !seen.has(`${id}|${title}`)) {
        seen.add(`${id}|${title}`);
        candidates.push({ id, title });
      }
    }
    if (Array.isArray(value)) value.forEach(walk);
    else Object.values(value).forEach(walk);
  };
  walk(payload);
  const ok = candidates.length > 0;
  console.log(`${ok ? '✅' : '❌'} playstation PS Plus catalog probe`, {
    candidates: candidates.length,
    samples: candidates.slice(0, 8)
  });
  if (!ok) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ playstation PS Plus catalog probe: ${error?.message || error}`);
}

try {
  const tiers = ['TIER_10', 'TIER_20', 'TIER_30'];
  const tierResults = {};
  let ok = true;
  for (const tier of tiers) {
    const payload = await providers.playstation.psPlus(tier, { force: true });
    const valid = Boolean(payload && typeof payload === 'object' && !Array.isArray(payload));
    tierResults[tier] = {
      ok: valid,
      hasData: Boolean(payload?.data),
      topLevelKeys: valid ? Object.keys(payload).slice(0, 8) : []
    };
    if (!valid) ok = false;
  }
  console.log(`${ok ? '✅' : '❌'} playstation PS Plus tier endpoint probe`, tierResults);
  if (!ok) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ playstation PS Plus tier endpoint probe: ${error?.message || error}`);
}

try {
  const catalog = await providers.playstation.psPlusCatalog({ force: true, size: 40 });
  const sample = catalog[0] || null;
  const item = sample ? await providers.playstation.product(sample.id, { force: true }) : null;
  const ok = Boolean(sample && item?.subscriptions?.psPlus === true);
  console.log(`${ok ? '✅' : '❌'} playstation PS Plus membership integration`, {
    catalogCount: catalog.length,
    sample: sample ? { id: sample.id, title: sample.title } : null,
    productId: item?.providerId || null,
    productTitle: item?.title || null,
    psPlus: Boolean(item?.subscriptions?.psPlus),
    psPlusSource: item?.rawHints?.psPlusSource || null
  });
  if (!ok) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ playstation PS Plus membership integration: ${error?.message || error}`);
}

try {
  const expectedProductId = 'UP9000-PPSA26344_00-GHOST2CE00000000';
  const item = await providers.playstation.concept('10003923', {
    force: true,
    preferredTitle: 'Ghost of Yōtei Complete Edition'
  });
  const current = Number(item?.price?.current);
  const priceProductId = String(item?.rawHints?.priceProductId || '').toUpperCase();
  const ok = Boolean(
    item
    && priceProductId === expectedProductId
    && Number.isFinite(current)
    && Math.abs(current - 1899) < 0.01
  );
  console.log(`${ok ? '✅' : '❌'} playstation Ghost of Yotei Complete Edition concept price probe`, {
    conceptId: item?.providerId || null,
    title: item?.title || null,
    price: item?.price || null,
    priceProductId: item?.rawHints?.priceProductId || null
  });
  if (!ok) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ playstation Ghost of Yotei Complete Edition concept price probe: ${error?.message || error}`);
}

try {
  const productId = 'UP9000-PPSA26344_00-GHOST2CE00000000';
  const item = await providers.playstation.product(productId, { force: true });
  const current = Number(item?.price?.current);
  const ok = Boolean(
    item
    && String(item?.providerId || '').toUpperCase() === productId
    && Number.isFinite(current)
    && Math.abs(current - 1899) < 0.01
  );
  console.log(`${ok ? '✅' : '❌'} playstation Ghost of Yotei Complete Edition direct product price probe`, {
    providerId: item?.providerId || null,
    title: item?.title || null,
    price: item?.price || null,
    priceProductId: item?.rawHints?.priceProductId || null,
    priceConceptId: item?.rawHints?.priceConceptId || null,
    priceFallback: item?.rawHints?.priceFallback || null
  });
  if (!ok) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ playstation Ghost of Yotei Complete Edition direct product price probe: ${error?.message || error}`);
}

try {
  const item = await providers.steam.product('292030', { force: true });
  const current = Number(item?.price?.current);
  const ok = Boolean(
    item
    && /witcher\s*3/i.test(String(item.title || ''))
    && Number.isFinite(current)
    && current > 0
    && /^https:\/\/store\.steampowered\.com\/app\/292030\//i.test(String(item.storeUrl || ''))
  );
  console.log(`${ok ? '✅' : '❌'} steam paid-price probe`, {
    providerId: item?.providerId || null,
    title: item?.title || null,
    price: item?.price || null,
    storeUrl: item?.storeUrl || null
  });
  if (!ok) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ steam paid-price probe: ${error?.message || error}`);
}

try {
  const item = await providers.steam.product('570', { force: true });
  const ok = Boolean(
    item
    && /dota\s*2/i.test(String(item.title || ''))
    && item?.price?.isFree === true
    && Number(item?.price?.current) === 0
  );
  console.log(`${ok ? '✅' : '❌'} steam free-price probe`, {
    providerId: item?.providerId || null,
    title: item?.title || null,
    price: item?.price || null
  });
  if (!ok) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ steam free-price probe: ${error?.message || error}`);
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
  const ninPriced = nintendoBase.some(item => {
    const current = Number(item?.price?.current);
    return item?.price?.isFree === true || (Number.isFinite(current) && current > 0);
  });
  const ninOk = nintendoBase.length >= 1 && nintendoBundle.length === 0
    && nintendoBase.every(item => item.releaseDate === '2026-09-25')
    && ninPriced;

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
    })),
    nintendoPriced:ninPriced
  });
  if (!ok) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ FC 27 base-edition pricing regression: ${error?.message || error}`);
}


try {
  const query = 'Grand Theft Auto VI';
  const parentId = '9NL3WWNZLZZN';
  const expectedBaseId = '9P3H4968GRSM';
  const parent = await providers.microsoft.product(parentId, { force: true });
  const search = await providers.microsoft.search(query, { force: true, limit: 8 });
  const priced = search.find(item => {
    const current = Number(item?.price?.current);
    return storefrontTitleScore(query, item?.title) >= 0.95
      && Number.isFinite(current)
      && Math.abs(current - 2009) < 0.01;
  }) || null;
  const ok = Boolean(priced);
  console.log(`${ok ? '✅' : '❌'} microsoft GTA VI base-edition price diagnostic`, {
    parent: {
      providerId: parent?.providerId || null,
      title: parent?.title || null,
      price: parent?.price || null,
      storeUrl: parent?.storeUrl || null,
      xboxPriceProductId: parent?.rawHints?.xboxPriceProductId || null,
      xboxPriceOfferTitle: parent?.rawHints?.xboxPriceOfferTitle || null
    },
    expectedBaseId,
    search: search.map(item => ({
      providerId: item?.providerId || null,
      title: item?.title || null,
      price: item?.price || null,
      storeUrl: item?.storeUrl || null,
      score: storefrontTitleScore(query, item?.title)
    }))
  });
  if (!ok) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ microsoft GTA VI base-edition price diagnostic: ${error?.message || error}`);
}

if (failed) {
  console.error(`\nEndpoint audit failed: ${failed} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nEndpoint audit passed.');
}
