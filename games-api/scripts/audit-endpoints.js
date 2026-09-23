import { saveHealth } from '../src/db.js';
import { providers } from '../src/providers/index.js';
import { titleScore } from '../src/lib/normalize.js';

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



async function subscriptionCatalogDiagnostic() {
  console.log('\n--- subscription catalog diagnostic ---');

  for (const kind of ['console','pc','cloud']) {
    try {
      const items = await providers.microsoft.gamePassCatalog(kind, { force:true, limit:5000 });
      console.log(`ℹ️ Game Pass ${kind}: ${items.length} items`, items.slice(0,3).map(item => ({
        id:item?.providerId || null,
        title:item?.title || null
      })));
    } catch (error) {
      console.log(`ℹ️ Game Pass ${kind} diagnostic failed: ${error?.message || error}`);
    }
  }

  try {
    const items = await providers.geforceNow.list({ force:true, maxPages:30 });
    console.log(`ℹ️ GeForce NOW catalog: ${items.length} items`, items.slice(0,3).map(item => ({
      id:item?.providerId || null,
      title:item?.title || null
    })));
  } catch (error) {
    console.log(`ℹ️ GeForce NOW diagnostic failed: ${error?.message || error}`);
  }

  for (const tier of ['TIER_10','TIER_20','TIER_30']) {
    try {
      const payload = await providers.playstation.psPlus(tier, { force:true });
      const keys = payload && typeof payload === 'object' ? Object.keys(payload) : [];
      const samples = [];
      const seen = new Set();
      const walk = (value, depth = 0) => {
        if (!value || typeof value !== 'object' || depth > 8 || samples.length >= 8) return;
        if (Array.isArray(value)) {
          for (const item of value) walk(item, depth + 1);
          return;
        }
        const title = value.name || value.title || value.productName || value.conceptName || value.displayName || '';
        const id = value.id || value.productId || value.conceptId || value.npTitleId || '';
        if (title && !seen.has(String(title))) {
          seen.add(String(title));
          samples.push({ title:String(title), id:String(id || ''), keys:Object.keys(value).slice(0,12) });
        }
        for (const child of Object.values(value)) walk(child, depth + 1);
      };
      walk(payload);
      console.log(`ℹ️ PS Plus ${tier}`, { topKeys:keys.slice(0,20), samples });
    } catch (error) {
      console.log(`ℹ️ PS Plus ${tier} diagnostic failed: ${error?.message || error}`);
    }
  }
}

await subscriptionCatalogDiagnostic();
