import { cleanText, titleScore } from './normalize.js';

function availabilityActions(availability = {}) {
  return (availability.Actions || availability.actions || [])
    .map(action => typeof action === 'string' ? action : action?.Action || action?.action || action?.Name || action?.name)
    .filter(Boolean)
    .map(String);
}

export function microsoftPriceOf(product) {
  const candidates = [];
  for (const sku of product?.DisplaySkuAvailabilities || []) {
    const skuInfo = sku?.Sku || sku?.sku || {};
    const skuTitle = skuInfo?.LocalizedProperties?.[0]?.SkuTitle
      || skuInfo?.LocalizedProperties?.[0]?.SkuDescription
      || skuInfo?.Title
      || skuInfo?.title
      || '';
    for (const availability of sku?.Availabilities || sku?.availabilities || []) {
      const raw = availability?.OrderManagementData?.Price || availability?.orderManagementData?.price;
      if (!raw) continue;
      const current = Number(raw.ListPrice ?? raw.listPrice ?? raw.MSRP ?? raw.msrp);
      const regular = Number(raw.MSRP ?? raw.msrp ?? raw.ListPrice ?? raw.listPrice);
      const actions = availabilityActions(availability);
      const purchasable = actions.some(action => /purchase|buy|pre.?order/i.test(action));
      const explicitFree = (raw.IsFree === true || raw.isFree === true)
        && purchasable
        && !/trial|demo|beta/i.test(skuTitle);
      const positive = Number.isFinite(current) && current > 0;
      if (!positive && !explicitFree) continue;
      candidates.push({
        currency: raw.CurrencyCode || raw.currencyCode || null,
        current: Number.isFinite(current) ? current : 0,
        regular: Number.isFinite(regular) ? regular : (Number.isFinite(current) ? current : 0),
        wholesale: Number(raw.WholesalePrice ?? raw.wholesalePrice ?? 0) || null,
        saleStart: availability?.Conditions?.StartDate || availability?.conditions?.startDate || null,
        saleEnd: availability?.Conditions?.EndDate || availability?.conditions?.endDate || null,
        purchasable: purchasable || positive || explicitFree,
        isFree: explicitFree,
        preorder: /pre.?order/i.test(skuTitle) || actions.some(action => /pre.?order/i.test(action)),
        skuTitle: cleanText(skuTitle)
      });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
    return a.current - b.current;
  });
  return candidates[0];
}

function truthySubscriptions(items = []) {
  const keys = ['gamePass','gamePassConsole','gamePassPc','cloudGaming','eaPlay'];
  return Object.fromEntries(keys.map(key => [key, items.some(item => Boolean(item?.subscriptions?.[key]))]));
}

function positivePrice(item) {
  const value = Number(item?.price?.current);
  return item?.price?.isFree === true || (Number.isFinite(value) && value > 0);
}

function isFullGameOffer(item) {
  const title = cleanText(item?.title || '').toLowerCase();
  if (!title) return false;
  return !/\b(upgrade|add[- ]?on|dlc|season pass|expansion pass|soundtrack|art ?book|coins?|credits?|points?|tokens?|currency|bonus pack)\b/i.test(title);
}

export function consolidateMicrosoftSearch(query, items = []) {
  const scored = (items || [])
    .filter(Boolean)
    .map(item => ({ item, score: titleScore(query, item.title) }))
    .filter(entry => entry.score >= 0.55)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];

  const primary = scored[0].item;
  const related = scored.map(entry => entry.item);
  const purchaseOffers = related
    .filter(item => positivePrice(item) && isFullGameOffer(item))
    .sort((a, b) => Number(a.price?.current ?? Infinity) - Number(b.price?.current ?? Infinity));
  const chosen = purchaseOffers[0] || null;
  const offers = purchaseOffers.map(item => ({
    title: item.title,
    providerId: item.providerId,
    storeUrl: item.storeUrl,
    price: item.price,
    preorder: Boolean(item.price?.preorder || /pre.?order/i.test(item.title || ''))
  }));

  primary.subscriptions = truthySubscriptions(related);
  primary.rawHints = {
    ...(primary.rawHints || {}),
    xboxOffers: offers,
    xboxEditionCount: offers.length
  };

  if (chosen) {
    const differentOffer = String(chosen.providerId || '') !== String(primary.providerId || '');
    primary.price = {
      ...chosen.price,
      from: differentOffer || purchaseOffers.length > 1,
      preorder: Boolean(chosen.price?.preorder || /pre.?order/i.test(chosen.title || '')),
      offerTitle: chosen.title || ''
    };
  } else if (!positivePrice(primary)) {
    primary.price = null;
  }

  const rest = (items || []).filter(item => item !== primary);
  return [primary, ...rest];
}
