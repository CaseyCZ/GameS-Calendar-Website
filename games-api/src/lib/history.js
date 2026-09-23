const SUBSCRIPTION_KEYS = [
  'gamePassConsole','gamePassPc','cloudGaming','eaPlay','psPlus','geforceNow'
];

function stableObject(entries = []) {
  return Object.fromEntries(entries.sort(([a],[b]) => String(a).localeCompare(String(b))));
}

function normalizeSubscriptions(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const entries = SUBSCRIPTION_KEYS.filter(key => Boolean(source[key])).map(key => [key, true]);
  const hasSpecificGamePass = Boolean(source.gamePassConsole || source.gamePassPc || source.cloudGaming);
  if (source.gamePass && !hasSpecificGamePass) entries.push(['gamePass', true]);
  return stableObject(entries);
}

function normalizePrices(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const entries = [];
  for (const [provider, price] of Object.entries(source)) {
    if (!price || typeof price !== 'object') continue;
    const text = String(price.currentText || '').trim();
    const current = Number(price.current);
    const isFree = price.isFree === true;
    if (!text && !isFree && !(Number.isFinite(current) && current > 0)) continue;
    const regular = Number(price.regular);
    const normalized = {
      currency: String(price.currency || '').trim().toUpperCase(),
      currentText: text,
      current: isFree ? 0 : (Number.isFinite(current) && current > 0 ? current : null),
      regular: Number.isFinite(regular) && regular > 0 ? regular : null,
      isFree
    };
    entries.push([provider, normalized]);
  }
  return stableObject(entries);
}

function normalizeReleaseDates(value) {
  const source = Array.isArray(value) ? value : (Array.isArray(value?.releases) ? value.releases : []);
  return source.map(item => ({
    day: item?.day || item?.date || null,
    window: String(item?.window || item?.label || '').trim(),
    precision: String(item?.precision || (item?.day || item?.date ? 'day' : 'unknown')).toLowerCase(),
    platform: String(item?.platform || '').trim(),
    platforms: (item?.platforms || [])
      .map(platform => typeof platform === 'string' ? platform : (platform?.abbreviation || platform?.name || ''))
      .filter(Boolean)
      .map(String)
      .sort((a,b)=>a.localeCompare(b))
  })).filter(item => item.day || item.window || item.platform || item.platforms.length)
    .sort((a,b) =>
      String(a.day || a.window).localeCompare(String(b.day || b.window))
      || a.platform.localeCompare(b.platform)
      || a.platforms.join('|').localeCompare(b.platforms.join('|'))
    );
}

function normalizeProviderIds(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return stableObject(Object.entries(source)
    .filter(([,id]) => id != null && String(id).trim())
    .map(([provider,id]) => [provider, String(id)]));
}

export function normalizeHistoryValue(field, value) {
  if (field === 'subscriptions') return normalizeSubscriptions(value);
  if (field === 'prices') return normalizePrices(value);
  if (field === 'releaseDates') return normalizeReleaseDates(value);
  if (field === 'providerIds') return normalizeProviderIds(value);
  if (field === 'earlyAccess') return value == null ? null : Boolean(value);
  if (field === 'title') return String(value || '').trim();
  return value;
}

export function historyValuesEqual(field, oldValue, newValue) {
  return JSON.stringify(normalizeHistoryValue(field, oldValue))
    === JSON.stringify(normalizeHistoryValue(field, newValue));
}
