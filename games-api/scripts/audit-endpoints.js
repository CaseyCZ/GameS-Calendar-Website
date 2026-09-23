import { saveHealth } from '../src/db.js';
import { providers } from '../src/providers/index.js';

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
  const items = await providers.microsoft.search(query, { force: true, limit: 5 });
  const item = items?.[0] || null;
  const price = Number(item?.price?.current);
  const hasPrice = item?.price?.isFree === true || (Number.isFinite(price) && price > 0);
  const hasGamePass = Boolean(item?.subscriptions?.gamePass);
  const hasXboxUrl = /^https:\/\/www\.xbox\.com\//i.test(String(item?.storeUrl || ''));
  const ok = Boolean(item && hasXboxUrl && (hasPrice || hasGamePass));
  console.log(`${ok ? '✅' : '❌'} microsoft E-Day live probe`, {
    title: item?.title || null,
    storeUrl: item?.storeUrl || null,
    price: item?.price || null,
    gamePass: hasGamePass,
    gamePassComingSoon: Boolean(item?.rawHints?.xboxGamePassComingSoon),
    offers: item?.rawHints?.xboxEditionCount || 0
  });
  if (!ok) failed += 1;
} catch (error) {
  failed += 1;
  console.error(`❌ microsoft E-Day live probe: ${error?.message || error}`);
}
