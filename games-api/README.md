# GameS Calendar API

Vlastní backend pro GameS Calendar. Data bere přímo z endpointů a HTML oficiálních obchodů/služeb a převádí je do jednotného formátu. Cizí projekty nejsou runtime závislost; sloužily pouze jako vodítko při mapování requestů.

## Zdroje

| Provider | Oficiální zdroj | Použití |
| --- | --- | --- |
| Microsoft / Xbox | `catalog.gamepass.com/sigls/v2` | Game Pass Console / PC / Cloud / EA Play Product ID |
| Microsoft Store | `displaycatalog.mp.microsoft.com/v7.0/products` | popis, publisher, developer, kategorie, release, média, rating, cena |
| Xbox Store | `xbox.com/<locale>/Search/Results` | hledání Product ID podle názvu |
| Steam Store | `store.steampowered.com/api/storesearch` | hledání App ID |
| Steam Store | `store.steampowered.com/api/appdetails` | detail hry, cena, release, žánry, media, trailer |
| Steamworks | `partner.steam-api.com/IStoreService/GetAppList/v1/` | kompletní/inkrementální seznam App ID; vyžaduje Web API key |
| PlayStation Store | `web.np.playstation.com/api/graphql/v1/op` | product/concept/catalog/PS Plus přes persisted GraphQL dotazy |
| Nintendo eShop | `ec.nintendo.com` + `api.ec.nintendo.com` | seznamy, title ID a regionální cena |
| Nintendo | `nintendo.com/.../store/products/...` | oficiální produktová HTML stránka; popis, release, publisher, média, systém |
| GeForce NOW | `api-prod.nvidia.com/services/gfngames/v1/gameList` | live katalog GFN, playType, obchody, obrázky |

PlayStation hash persisted query se může změnit. Všechny používané hashe lze přepsat přes environment variables bez změny zdrojáku.

## Spuštění

```bash
cd games-api
npm install
cp .env.example .env
npm start
```

Node.js 22.13+ je vyžadován kvůli vestavěnému `node:sqlite`. SQLite drží krátkodobou serverovou cache, provider health a historii důležitých změn. Telefon už nemusí držet několikahodinová metadata jako primární zdroj.

## API

```text
GET  /health
GET  /health?refresh=1
GET  /api/catalog
GET  /api/catalog?view=list
GET  /api/catalog/game/:gameId
GET  /api/discover?q=Gears%20of%20War%202
GET  /api/catalog-meta
GET  /api/search?q=Kingdom%20Come&providers=steam,microsoft,playstation,nintendo,geforceNow
POST /api/enrich
GET  /api/gamepass/console
GET  /api/gamepass/pc
GET  /api/gamepass/cloud
GET  /api/gamepass/eaPlay
GET  /api/steam/:appId
GET  /api/steam-app-list?since=0
GET  /api/xbox/:productId
GET  /api/playstation/product/:productId
GET  /api/playstation/concept/:conceptId
GET  /api/playstation/plus/TIER_20
GET  /api/playstation/catalog/all?size=100&offset=0
GET  /api/nintendo?url=https://www.nintendo.com/us/store/products/.../
GET  /api/nintendo?id=70010000063715
GET  /api/nintendo/list/new
GET  /api/nintendo/price/70010000063715
GET  /api/gfn/search?q=Cyberpunk
GET  /api/gfn/catalog
GET  /api/history/:gameKey
```

### Cesty na běžícím serveru

Na `https://130.61.49.108` (také port 8443) používá Nginx `/games-api/` místo interního `/api/`, například `/games-api/catalog` a `/games-api/search`. Stav je na `/games-health`; samotné `/health` není veřejná cesta. `/health` bez `refresh=1` vrací dostupnost API a uložené výsledky, nikoli nový test všech zdrojů.

### Live enrichment

```json
{
  "games": [
    { "title": "Kingdom Come: Deliverance II", "steamId": "1771300" },
    { "title": "Minecraft", "psConceptId": "212779" }
  ]
}
```

Pošli JSON na `POST /api/enrich`. API nejdřív použije známá provider ID. Pokud nejsou k dispozici, hledá podle názvu a přijme jen dostatečně podobnou shodu. Výstup obsahuje originální provider data i sloučený `merged` objekt, `fieldSources` s původem polí a případné `changes` oproti poslednímu snapshotu.

## Cache

Cache je serverová a per-provider. Game Pass/GFN se obnovují po hodině, produktová metadata zhruba po 6 hodinách a Nintendo produktové stránky po 12 hodinách. Zpracovaný katalog zůstává v paměti do změny souboru; `/api/catalog-meta` umožňuje klientovi ověřit verzi bez opakovaného stažení celého katalogu. `?refresh=1` cache providerů obejde.

## Endpoint audit

```bash
npm run audit
```

Audit ověří každý provider na reálném oficiálním zdroji. Stejný audit běží denně přes GitHub Actions a upozorní, když Microsoft/Sony/Valve/Nintendo/NVIDIA změní endpoint nebo formát.

## Oracle Cloud

Backend je určený pro Oracle Compute VM za Nginxem. Nginx může servírovat současný frontend a `/api/` proxyovat na `127.0.0.1:8787`. Tím frontend používá API ze stejné domény bez CORS problémů. Ukázkové konfigurace jsou v `deploy/`.

## Historie změn

Při `POST /api/enrich` se ukládá malý snapshot důležitých polí. Změna data vydání, předplatného, ceny nebo provider ID se zapíše do `change_history`. Díky tomu může frontend později zobrazit například **ODLOŽENO** nebo historii ceny bez ukládání celých odpovědí obchodů.

Podrobné rozdělení endpointů na dokumentované / oficiální interní / HTML je v [`OFFICIAL-ENDPOINTS.md`](OFFICIAL-ENDPOINTS.md).
