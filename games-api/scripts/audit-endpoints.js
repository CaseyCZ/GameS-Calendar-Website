import { saveHealth } from '../src/db.js';
import { providers } from '../src/providers/index.js';
import { config } from '../src/config.js';
import { fetchJson } from '../src/lib/http.js';
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
  const items = await providers.microsoft.search(query, { force: true, limit: 5 });
  const item = items?.[0] || null;
  const price = Number(item?.price?.current);
  const hasPrice = item?.price?.isFree === true || (Number.isFinite(price) && price > 0);
  const hasGamePass = Boolean(item?.subscriptions?.gamePass);
  const hasXboxUrl = /^https:\/\/www\.xbox\.com\//i.test(String(item?.storeUrl || ''));
  const score = item ? titleScore(query, item.title) : 0;
  const ok = Boolean(item && score >= 0.8 && hasXboxUrl && (hasPrice || hasGamePass));
  console.log(`${ok ? '✅' : '❌'} microsoft E-Day live probe`, {
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
  console.error(`❌ microsoft E-Day live probe: ${error?.message || error}`);
}

try {
  const query = 'Gears of War: E-Day';
  const url = new URL('https://reco-public.rec.mp.microsoft.com/channels/Reco/V8.0/Lists/Search');
  url.searchParams.set('Market', config.market);
  url.searchParams.set('Language', config.language);
  url.searchParams.set('ItemTypes', 'Game');
  url.searchParams.set('DeviceFamily', 'Windows.Xbox');
  url.searchParams.set('Count', '20');
  url.searchParams.set('SkipItems', '0');
  url.searchParams.set('Query', query);
  const payload = await fetchJson(url);
  const items = payload?.Items || payload?.items || payload?.Products || payload?.products || [];
  console.log('ℹ️ microsoft reco E-Day probe', {
    endpoint: url.href,
    keys: Object.keys(payload || {}).slice(0, 20),
    count: Array.isArray(items) ? items.length : null,
    sample: Array.isArray(items) ? items.slice(0, 5).map(item => ({
      id: item?.Id || item?.id || item?.ProductId || item?.productId || null,
      title: item?.Title || item?.title || item?.Name || item?.name || null
    })) : null
  });
} catch (error) {
  console.log('ℹ️ microsoft reco E-Day probe failed', error?.message || String(error));
}
