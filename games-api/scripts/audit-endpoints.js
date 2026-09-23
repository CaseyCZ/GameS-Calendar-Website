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
  const wrong = fallback.find(item => titleScore('Gears of War: E-Day', item?.title) < 0.55);
  const ok = !wrong;
  console.log(`${ok ? '✅' : '❌'} microsoft E-Day fallback safety probe`, {
    count: fallback.length,
    titles: fallback.map(item => item?.title || null).slice(0, 5)
  });
  if (!ok) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ microsoft E-Day fallback safety probe: ${error?.message || error}`);
}



try {
  const query = 'EA SPORTS FC 27';
  const igdbHits = await providers.igdb.search(query, { force:true, limit:20 });
  const identity = (igdbHits || [])
    .map(item => ({ item, score:titleScore(query, item?.title) }))
    .sort((a,b) => b.score - a.score)[0]?.item || null;
  const ids = identity?.externalIds || identity?.rawHints?.externalIds || {};

  const summarize = item => item ? {
    provider:item.provider || null,
    providerId:item.providerId || null,
    title:item.title || null,
    price:item.price || null,
    storeUrl:item.storeUrl || null,
    titleScore:titleScore(query, item.title),
    storefrontScore:storefrontTitleScore(query, item.title)
  } : null;

  let xboxDirect = null;
  const xboxId = ids.microsoft || ids.xbox || '';
  if (xboxId) {
    try { xboxDirect = await providers.microsoft.product(String(xboxId), { force:true }); }
    catch (error) { xboxDirect = { error:error?.message || String(error), providerId:xboxId }; }
  }

  let psDirect = null;
  try {
    if (ids.playstationProduct) psDirect = await providers.playstation.product(String(ids.playstationProduct), { force:true });
    else if (ids.playstationConcept) psDirect = await providers.playstation.concept(String(ids.playstationConcept), { force:true });
    else if (ids.playstation) {
      psDirect = /^\d+$/.test(String(ids.playstation))
        ? await providers.playstation.concept(String(ids.playstation), { force:true })
        : await providers.playstation.product(String(ids.playstation), { force:true });
    }
  } catch (error) {
    psDirect = { error:error?.message || String(error), providerId:ids.playstationProduct || ids.playstationConcept || ids.playstation || '' };
  }

  const searches = {};
  for (const [name, provider] of [['microsoft',providers.microsoft],['playstation',providers.playstation],['nintendo',providers.nintendo]]) {
    try {
      const items = await provider.search(query, { force:true, limit:8 });
      searches[name] = items.map(summarize);
    } catch (error) {
      searches[name] = [{ error:error?.message || String(error) }];
    }
  }

  console.log('ℹ️ FC 27 storefront diagnostic', {
    igdb:summarize(identity),
    externalIds:ids,
    xboxDirect:summarize(xboxDirect) || xboxDirect,
    psDirect:summarize(psDirect) || psDirect,
    searches
  });
} catch (error) {
  console.log('ℹ️ FC 27 storefront diagnostic failed', error?.stack || error?.message || String(error));
}
