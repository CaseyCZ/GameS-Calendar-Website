# Official endpoint map

GameS API volá pouze služby a webové endpointy provozované přímo platformou. Cizí open-source projekty nejsou runtime zdroj dat; byly použity jen k ověření parametrů a názvů requestů, které dělají oficiální weby.

## Stabilita

- **Dokumentované**: výrobce endpoint veřejně dokumentuje. Nejméně riziková integrace.
- **Oficiální interní**: endpoint používá oficiální storefront, ale není garantovaným veřejným API. Musí mít health test a fallback.
- **Oficiální HTML**: čteme server-rendered produktovou stránku. Selektory se mohou změnit.

| Provider | Endpoint | Typ | Auth | Co používáme |
| --- | --- | --- | --- | --- |
| Xbox Game Pass | `https://catalog.gamepass.com/sigls/v2` | oficiální interní | ne | Product ID pro Console, PC, Cloud, EA Play |
| Microsoft Store | `https://displaycatalog.mp.microsoft.com/v7.0/products` | oficiální interní | ne | titul, popis, release, publisher/developer, kategorie, obrázky, rating, cena |
| Xbox Store | `https://www.xbox.com/<locale>/Search/Results?q=` | oficiální HTML | ne | dohledání Microsoft Product ID podle názvu |
| Steam Store | `https://store.steampowered.com/api/storesearch/` | oficiální interní | ne | vyhledání App ID |
| Steam Store | `https://store.steampowered.com/api/appdetails` | oficiální interní | ne | detail, cena, release, žánry, media, trailery |
| Steamworks | `https://partner.steam-api.com/IStoreService/GetAppList/v1/` | dokumentované | Web API key | kompletní/inkrementální App ID katalog |
| PlayStation Store | `https://web.np.playstation.com/api/graphql/v1/op` | oficiální interní | ne pro storefront dotazy | product, concept, catalog, PS Plus, price, media |
| Nintendo eShop | `https://ec.nintendo.com/api/<country>/<lang>/search/<list>` | oficiální interní | ne | `sales`, `new`, `ranking` katalogy |
| Nintendo eShop | `https://api.ec.nintendo.com/v1/price` | oficiální interní | ne | regionální cena dle title ID |
| Nintendo | `https://www.nintendo.com/<region>/store/products/...` | oficiální HTML | ne | popis, release, publisher/developer, systém, média |
| GeForce NOW | `https://api-prod.nvidia.com/services/gfngames/v1/gameList` | oficiální interní | ne | katalog, stores, play type, membership tier, media |

## Xbox / Microsoft

Game Pass list IDs:

```text
console f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e
pc      fdd9e2a7-0fee-49f6-ad69-4354098401ff
cloud   29a81209-df6f-41fd-a528-2ae6b91f719c
eaPlay  b8900d09-a491-44cc-916e-32b5acae621b
```

`displaycatalog` se dotazuje po dávkách, aby URL nebyla příliš dlouhá. Membership se neurčuje podle textu názvu: Product ID se porovnává se skutečnými SIGL seznamy.

## Steam

`storesearch` a `appdetails` jsou endpointy Steam Store a fungují bez klíče, ale Valve je negarantuje jako veřejnou Steamworks API smlouvu. Proto jsou pod denním health testem.

Pro úplný App ID feed je připraven dokumentovaný `IStoreService/GetAppList/v1/`. Ten je volitelný a `STEAM_WEB_API_KEY` zůstává pouze na serveru.

## PlayStation

Storefront používá persisted GraphQL queries. Request má `operationName`, `variables`, `extensions.persistedQuery.version = 1`, `sha256Hash` a header `x-psn-store-locale-override`.

Sony může hash při nasazení frontendu změnit. Proto jsou hashe v `.env` přepisovatelné a `/health?refresh=1` chybu okamžitě ukáže.

Mapované operace v první verzi:

```text
metGetProductById
metGetConceptById
metGetPricingDataByConceptId
conceptRetrieveForMedia
categoryGridRetrieve
featuresRetrieve
```

PS Plus tier labels:

```text
TIER_10 Essential
TIER_20 Extra
TIER_30 Deluxe/Premium podle regionu
```

## Nintendo

Pro ČR je eShop katalog dostupný přes `CZ/en`. Cena se bere z price endpointu podle 14místného Nintendo title ID. Když máme pouze produktovou URL, provider zároveň zkusí ID najít ve stránce a cenu doplnit.

Nintendo nemá v této integraci jeden spolehlivý veřejný full-text katalog pro všechny regiony. Search proto kombinuje oficiální eShop listy, Nintendo web search a přímou produktovou stránku. Nevymýšlí data, která oficiální zdroj nevrátí.

## GeForce NOW

`gameList` očekává raw GraphQL document jako POST body, nikoli `{ "query": ... }` envelope. Pagination používá `pageInfo.endCursor` a `hasNextPage`.

## Health policy

Každý provider musí projít reálným requestem. Audit běží denně přes GitHub Actions a stejný audit lze na Oracle pustit příkazem:

```bash
npm run audit
```

Interní endpoint se nepovažuje za funkční jen proto, že vrací HTTP 200: health kontroluje také očekávané pole / neprázdný katalog.
