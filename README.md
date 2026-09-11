# GameS Calendar 2.0

Moderní, rychlý herní kalendář a vyhledávač vydání her založený na datech z IGDB. Frontend zůstává statický a je vhodný pro GitHub Pages; tajné IGDB/Twitch údaje se používají pouze při serverovém/build-time generování `games.json`.

## Co verze 2.0 přidává

- moderní dark/glass UI bez runtime Tailwind CDN
- okamžité vyhledávání s debounce
- multi-select platformy: PC, PS5, Xbox Series, Switch, Switch 2 a VR
- filtry podle žánru, stavu vydání, měsíce a roku
- přesné měsíční počty respektující aktivní filtry
- grid a kompaktní zobrazení
- detail hry v modalu: popis, žánr, vývojář, vydavatel, hodnocení, platformy
- přímé odkazy z IGDB na oficiální web / Steam / Epic / Reddit; fallback na vyhledávání, pokud IGDB přímý odkaz nemá
- YouTube trailer načtený až při otevření
- Watchlist v `localStorage`
- countdown do vydání
- Google Calendar + správný celodenní `.ics` export pro Apple Calendar / Outlook
- export celého aktuálního výběru do `.ics`
- lazy loading obalů, skeleton loading a stránkované vykreslování velkých výsledků
- IndexedDB cache + stale fallback při výpadku sítě
- PWA manifest + service worker/offline aplikační shell
- sdílení aktuálních filtrů v URL
- plná česká lokalizace datumů (`cs-CZ`)
- kompatibilita se starým `games.json`; detailní metadata se objeví po prvním spuštění nového fetch skriptu

## Architektura

```text
index.html                    # sémantické UI
styles.css                    # kompletní vzhled, responzivita, animace
js/app.js                     # stav aplikace, filtry a události
js/ui.js                      # rendering karet, modalu a UI helpery
js/data.js                    # normalizace dat + IndexedDB cache
js/calendar.js                # Google Calendar a RFC5545 .ics
fetch-games.js                # IGDB/Twitch datová vrstva
manifest.webmanifest          # PWA
sw.js                         # offline cache
.github/workflows/update-games.yml
                               # denní automatická aktualizace games.json
games.json                    # generovaná data
CaseyCZ.png                   # logo / PWA ikona
```

## Jak fungují data

IGDB API nepovoluje přímé browserové CORS volání a Client Secret nesmí být ve frontendu. Proto `fetch-games.js` získá Twitch App Access Token, stáhne release data a detailnější metadata z IGDB a bezpečně vytvoří statický `games.json`. Web pak pracuje jen s tímto souborem a může být extrémně rychlý i na GitHub Pages.

Nový skript standardně načítá 6 měsíců historie a 18 měsíců budoucnosti. Platformy se nejprve objeví dynamicky přes IGDB `platforms` endpoint, takže není nutné udržovat ID Switch 2/VR ručně. Při výpadku tohoto lookupu zůstává fallback pro PC, PS5, Xbox Series X|S a Nintendo Switch.

### Nový datový formát

```json
{
  "version": 2,
  "generatedAt": "2026-09-11T12:00:00.000Z",
  "range": { "from": "2026-03-01", "to": "2028-02-29" },
  "games": [
    {
      "id": 123,
      "name": "Example Game",
      "summary": "…",
      "cover": "https://images.igdb.com/…",
      "genres": ["Role-playing (RPG)"],
      "developers": ["Studio"],
      "publishers": ["Publisher"],
      "rating": 86.4,
      "links": {
        "official": "https://…",
        "steam": "https://…",
        "epic": "",
        "reddit": "",
        "igdb": "https://www.igdb.com/…"
      },
      "releases": [
        {
          "date": "2026-10-15",
          "platforms": [{ "id": 6, "name": "PC (Microsoft Windows)" }]
        }
      ]
    }
  ]
}
```

## Lokální spuštění

Požadavky: Node.js 18+.

```bash
npm install
```

Vytvoř `.env` (nenahrávat do Gitu):

```env
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
```

Data obnovíš:

```bash
npm run fetch-games
```

Statické soubory otevři přes lokální HTTP server, například:

```bash
python -m http.server 8080
```

Pak otevři `http://localhost:8080`.

## GitHub Actions

V repozitáři nastav v **Settings → Secrets and variables → Actions**:

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`

Workflow `.github/workflows/update-games.yml` spouští aktualizaci jednou denně a `games.json` commitne pouze tehdy, pokud se skutečně změnil. Lze ho spustit i ručně přes **Actions → Update IGDB game data → Run workflow**.

## Volitelné proměnné

```env
IGDB_MONTHS_PAST=6
IGDB_MONTHS_FUTURE=18
# Volitelně lze dynamický výběr platforem kompletně nahradit vlastním seznamem ID:
IGDB_PLATFORM_IDS=6,167,169,130
GAMES_OUTPUT=games.json
```

## GitHub Pages

Web nevyžaduje build. GitHub Pages může dál publikovat přímo větev `main`. Service worker funguje na HTTPS automaticky.

## Poznámka k cenám / CZK

IGDB neposkytuje aktuální prodejní ceny obchodů. UI je plně české a používá český formát data, ale cenu v Kč záměrně nevymýšlí. Pro skutečné ceny v CZK je potřeba připojit samostatné store API (Steam/Epic nebo agregátor cen) a řešit jeho podmínky a cache zvlášť.

## Bezpečnost

Nikdy nevkládej `TWITCH_CLIENT_SECRET` do `index.html`, JavaScriptu prohlížeče ani do `games.json`. Tajné údaje patří pouze do lokálního `.env` nebo GitHub Actions Secrets.
