import { cleanText, storefrontTitleScore, titleScore } from './normalize.js';

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

const PREMIUM_EDITION_RE = /\b(ultimate|deluxe|premium|gold|collector'?s?|vault|special|anniversary)\b/i;

function isPremiumEdition(item) {
  return PREMIUM_EDITION_RE.test(cleanText(item?.title || ''));
}

export function consolidateMicrosoftSearch(query, items = []) {
  const wantsPremium = PREMIUM_EDITION_RE.test(cleanText(query || ''));
  const candidates = (items || []).filter(Boolean).map(item => ({
    item,
    score: titleScore(query, item.title),
    storefrontScore: storefrontTitleScore(query, item.title)
  }));

  const scored = candidates
    .filter(entry => entry.storefrontScore >= 0.55)
    .sort((a, b) =>
      b.storefrontScore - a.storefrontScore
      || b.score - a.score
      || Number(a.item?.price?.current ?? Infinity) - Number(b.item?.price?.current ?? Infinity)
    );
  if (!scored.length) return [];

  const related = candidates
    .filter(entry => entry.score >= 0.40)
    .map(entry => entry.item);

  const primaryEntry = wantsPremium
    ? scored[0]
    : scored.find(entry => isFullGameOffer(entry.item) && !isPremiumEdition(entry.item)) || scored[0];
  const primary = primaryEntry.item;

  const purchaseOffers = candidates
    .filter(entry =>
      entry.score >= 0.40
      && positivePrice(entry.item)
      && isFullGameOffer(entry.item)
    )
    .sort((a, b) => {
      if (!wantsPremium) {
        const ap = isPremiumEdition(a.item);
        const bp = isPremiumEdition(b.item);
        if (ap !== bp) return ap ? 1 : -1;
      }
      return b.storefrontScore - a.storefrontScore
        || Number(a.item?.price?.current ?? Infinity) - Number(b.item?.price?.current ?? Infinity);
    })
    .map(entry => entry.item);

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
    xboxEditionCount: offers.length,
    selectedEdition: isPremiumEdition(primary) ? 'premium' : 'standard'
  };

  if (chosen) {
    const chosenIsPrimary = String(chosen.providerId || '') === String(primary.providerId || '');
    if (!chosenIsPrimary && !wantsPremium && !isPremiumEdition(chosen)) {
      primary.providerId = chosen.providerId;
      primary.title = chosen.title;
      primary.storeUrl = chosen.storeUrl;
    }
    primary.price = {
      ...chosen.price,
      from: purchaseOffers.length > 1,
      preorder: Boolean(chosen.price?.preorder || /pre.?order/i.test(chosen.title || '')),
      offerTitle: chosen.title || ''
    };
  } else if (!positivePrice(primary)) {
    primary.price = null;
  }

  const rest = related.filter(item => item !== primary);
  return [primary, ...rest];
}
