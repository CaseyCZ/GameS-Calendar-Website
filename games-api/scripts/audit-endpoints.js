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
  const ps = await providers.playstation.concept('10017332', { force:true });
  const psPrice = Number(ps?.price?.current);
  const psStandard = /STANDARD|BASE/i.test(String(ps?.rawHints?.priceProductId || ''));
  const psOk = psStandard && Number.isFinite(psPrice) && Math.abs(psPrice - 1899) < 0.01;
  console.log(`${psOk ? '✅' : '❌'} FC 27 Standard edition probe · PlayStation`, {
    productId:ps?.rawHints?.priceProductId || null,
    price:ps?.price || null
  });
  if (!psOk) failed += 1;

  const nintendo = await providers.nintendo.search('EA Sports FC 27', { force:true, limit:6 });
  const exact = nintendo.filter(item => storefrontTitleScore('EA Sports FC 27', item?.title) >= 1);
  const bundle = exact.find(item => /^700700/.test(String(item?.providerId || '')));
  const base = exact.find(item => /^700100/.test(String(item?.providerId || '')));
  const nintendoOk = Boolean(base && !bundle && base.releaseDate === '2026-09-25');
  console.log(`${nintendoOk ? '✅' : '❌'} FC 27 Standard edition probe · Nintendo`, exact.map(item => ({
    providerId:item?.providerId || null,
    releaseDate:item?.releaseDate || null,
    price:item?.price || null
  })));
  if (!nintendoOk) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ FC 27 Standard edition probe: ${error?.message || error}`);
}
