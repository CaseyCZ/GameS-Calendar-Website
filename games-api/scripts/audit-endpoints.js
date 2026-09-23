import { saveHealth } from '../src/db.js';
import { providers } from '../src/providers/index.js';
import { igdbProvider } from '../src/providers/igdb.js';
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
  const query = 'EA Sports FC 27';
  const checks = [];
  for (const name of ['playstation','nintendo','steam']) {
    const provider = providers[name];
    if (!provider?.search) continue;
    try {
      const items = await provider.search(query, { force:true, limit:5 });
      const item = items?.[0] || null;
      const title = String(item?.title || '');
      const score = item ? storefrontTitleScore(query, title) : 0;
      const wrongEdition = /\b(ultimate|deluxe|premium|upgrade|vault)\b/i.test(title);
      const price = item?.price || null;
      checks.push({ provider:name, title, score, wrongEdition, price, storeUrl:item?.storeUrl || null });
    } catch (error) {
      checks.push({ provider:name, error:error?.message || String(error) });
    }
  }

  const failedChecks = checks.filter(item =>
    item.error
    || !item.title
    || item.score < 0.55
    || item.wrongEdition
  );
  const ok = failedChecks.length === 0;
  console.log(`${ok ? '✅' : '❌'} FC 27 storefront edition probe`, checks);
  if (!ok) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ FC 27 storefront edition probe: ${error?.message || error}`);
}


try {
  const igdb = await igdbProvider.product('408819', { force:true });
  const ids = igdb?.externalIds || igdb?.rawHints?.externalIds || {};
  const diagnostic = {
    igdbTitle: igdb?.title || null,
    externalIds: ids,
    websites: igdb?.websites || igdb?.rawHints?.websites || []
  };

  if (providers.playstation) {
    const ps = {};
    if (ids.playstationProduct) {
      try { ps.product = await providers.playstation.product(String(ids.playstationProduct), { force:true }); }
      catch (error) { ps.productError = error?.message || String(error); }
    }
    if (ids.playstationConcept) {
      try { ps.concept = await providers.playstation.concept(String(ids.playstationConcept), { force:true }); }
      catch (error) { ps.conceptError = error?.message || String(error); }
    }
    if (ids.playstation && !ids.playstationProduct && !ids.playstationConcept) {
      try {
        if (/^\d+$/.test(String(ids.playstation))) ps.concept = await providers.playstation.concept(String(ids.playstation), { force:true });
        else ps.product = await providers.playstation.product(String(ids.playstation), { force:true });
      } catch (error) { ps.genericError = error?.message || String(error); }
    }
    diagnostic.playstation = {
      product: ps.product ? { id:ps.product.providerId, title:ps.product.title, price:ps.product.price, storeUrl:ps.product.storeUrl } : null,
      concept: ps.concept ? { id:ps.concept.providerId, title:ps.concept.title, price:ps.concept.price, storeUrl:ps.concept.storeUrl } : null,
      errors:{ product:ps.productError || null, concept:ps.conceptError || null, generic:ps.genericError || null }
    };
  }

  if (providers.nintendo) {
    try {
      const items = await providers.nintendo.search('EA Sports FC 27', { force:true, limit:10 });
      diagnostic.nintendo = items.map(item => ({
        id:item?.providerId || null,
        title:item?.title || null,
        price:item?.price || null,
        storeUrl:item?.storeUrl || null,
        productCodes:item?.rawHints?.productCodes || [],
        playableOn:item?.rawHints?.playableOn || []
      }));
    } catch (error) {
      diagnostic.nintendoError = error?.message || String(error);
    }
  }

  console.log('ℹ️ FC 27 identity diagnostic', diagnostic);
} catch (error) {
  console.log(`ℹ️ FC 27 identity diagnostic failed: ${error?.message || error}`);
}


try {
  const response = await fetch('https://130.61.49.108/games-api/enrich?force=1', {
    method:'POST',
    headers:{ 'content-type':'application/json', accept:'application/json' },
    body:JSON.stringify({
      game:{ id:'408819', igdbId:'408819', title:'EA Sports FC 27' },
      providers:['igdb','playstation','nintendo','microsoft','steam','epic']
    })
  });
  const payload = await response.json();
  console.log('ℹ️ FC 27 live enrich diagnostic', {
    status:response.status,
    identity:payload?.identity || null,
    providers:Object.fromEntries(Object.entries(payload?.providers || {}).map(([name,item]) => [name, item ? {
      providerId:item.providerId || null,
      title:item.title || null,
      price:item.price || null,
      storeUrl:item.storeUrl || null,
      externalIds:item.externalIds || item.rawHints?.externalIds || null
    } : null]))
  });
} catch (error) {
  console.log(`ℹ️ FC 27 live enrich diagnostic failed: ${error?.message || error}`);
}

try {
  const language = 'en';
  const url = new URL(`https://searching.nintendo-europe.com/${language}/select`);
  url.searchParams.set('q', 'EA Sports FC 27');
  url.searchParams.set('fq', 'type:GAME');
  url.searchParams.set('rows', '30');
  url.searchParams.set('wt', 'json');
  const response = await fetch(url, { headers:{ accept:'application/json' } });
  const payload = await response.json();
  const docs = Array.isArray(payload?.response?.docs) ? payload.response.docs : [];
  console.log('ℹ️ FC 27 raw Nintendo diagnostic', docs.slice(0, 20).map(doc => ({
    title:doc.title || null,
    sortingTitle:doc.sorting_title || null,
    nsuid:doc.nsuid_txt || null,
    relatedNsuids:doc.related_nsuids_txt || null,
    fsId:doc.fs_id || null,
    url:doc.url || doc.gift_finder_detail_page_store_link_s || null,
    productCodes:doc.product_code_txt || null,
    playableOn:doc.playable_on_txt || null,
    dateFrom:doc.date_from || null,
    releaseDate:doc.release_date_on_eshop || null
  })));
} catch (error) {
  console.log(`ℹ️ FC 27 raw Nintendo diagnostic failed: ${error?.message || error}`);
}
