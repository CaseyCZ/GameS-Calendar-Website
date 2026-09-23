function epicTime(value) {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function epicOfferAllowsPrice(item = {}, now = Date.now()) {
  const prePurchase = item?.prePurchase === true || /^true$/i.test(String(item?.prePurchase || ''));
  if (prePurchase) return true;

  const futureGate = [item?.effectiveDate, item?.pcReleaseDate, item?.releaseDate]
    .map(epicTime)
    .filter(Number.isFinite)
    .some(timestamp => timestamp > now);

  return !futureGate;
}

export function epicPriceOf(item = {}, { now = Date.now() } = {}) {
  if (!epicOfferAllowsPrice(item, now)) return null;
  const total = item?.price?.totalPrice || {};
  const decimals = Number(total?.currencyInfo?.decimals);
  const divisor = 10 ** (Number.isFinite(decimals) ? decimals : 2);
  const currentRaw = Number(total.discountPrice);
  const regularRaw = Number(total.originalPrice);
  const currentText = String(total?.fmtPrice?.discountPrice || '').trim();
  const regularText = String(total?.fmtPrice?.originalPrice || '').trim();
  const currency = String(total.currencyCode || '').trim().toUpperCase();

  const current = Number.isFinite(currentRaw) ? currentRaw / divisor : null;
  const regular = Number.isFinite(regularRaw) ? regularRaw / divisor : null;
  const freeText = /\bfree\b|zdarma|bezplat/i.test(currentText);
  const isFree = freeText || (
    Number.isFinite(current) && current === 0
    && Number.isFinite(regular) && regular === 0
    && Boolean(currentText || regularText)
  );

  if (!isFree && !(Number.isFinite(current) && current > 0) && !currentText) return null;

  let discountPercent = 0;
  if (Number.isFinite(regular) && regular > 0 && Number.isFinite(current) && current >= 0 && current < regular) {
    discountPercent = Math.round((1 - current / regular) * 100);
  }

  return {
    currency: currency || null,
    current: isFree ? 0 : current,
    regular: Number.isFinite(regular) && regular > 0 ? regular : (isFree ? 0 : null),
    currentText: currentText || null,
    regularText: regularText || null,
    discountPercent,
    isFree,
    preorder: item?.prePurchase === true || /^true$/i.test(String(item?.prePurchase || ''))
  };
}

export function epicStoreSlugOf(item = {}) {
  const mappings = [
    ...(Array.isArray(item?.catalogNs?.mappings) ? item.catalogNs.mappings : []),
    ...(Array.isArray(item?.offerMappings) ? item.offerMappings : [])
  ];
  const mapped = mappings.find(entry => entry?.pageType === 'productHome' && entry?.pageSlug)?.pageSlug
    || mappings.find(entry => entry?.pageSlug)?.pageSlug;
  const product = String(item?.productSlug || '').replace(/\/home\/?$/i, '').replace(/^\/+|\/+$/g, '');
  return String(mapped || product || item?.urlSlug || '').trim();
}

export function epicStoreUrlOf(item = {}, { locale = 'en-US' } = {}) {
  const direct = String(item?.url || '').trim();
  if (/^https:\/\/store\.epicgames\.com\//i.test(direct)) return direct;
  const slug = epicStoreSlugOf(item);
  if (!slug) return '';
  return `https://store.epicgames.com/${encodeURIComponent(locale)}/p/${slug.split('/').map(encodeURIComponent).join('/')}`;
}

export function epicIsGameOffer(item = {}) {
  const paths = (item?.categories || []).map(entry => String(entry?.path || entry || '').toLowerCase());
  return !paths.length || paths.some(path => path === 'games' || path.startsWith('games/edition'));
}
