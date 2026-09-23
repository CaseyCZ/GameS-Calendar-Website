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
  const query = 'EA Sports FC 27';
  const identity = await providers.igdb?.product?.('408819', { force:true }).catch(() => null);
  console.log('ℹ️ FC 27 IGDB identity', {
    providerId:identity?.providerId || null,
    title:identity?.title || null,
    externalIds:identity?.externalIds || identity?.rawHints?.externalIds || {},
    websites:identity?.websites || identity?.rawHints?.websites || []
  });

  for (const name of ['steam','epic','microsoft','playstation','nintendo']) {
    const provider = providers[name];
    if (!provider?.search) continue;
    try {
      const items = await provider.search(query, { force:true, limit:10 });
      console.log(`ℹ️ FC 27 edition diagnostic ${name}`, items.map(item => ({
        providerId:item?.providerId || null,
        title:item?.title || null,
        score:titleScore(query, item?.title),
        storefrontScore:storefrontTitleScore(query, item?.title),
        price:item?.price || null,
        storeUrl:item?.storeUrl || null
      })));
    } catch (error) {
      console.log(`ℹ️ FC 27 edition diagnostic ${name} failed: ${error?.message || error}`);
    }
  }
} catch (error) {
  console.log(`ℹ️ FC 27 edition diagnostic failed: ${error?.message || error}`);
}
