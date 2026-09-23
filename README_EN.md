<p align="center">
  <img src="assets/games-readme-header.svg" alt="GameS Calendar by CaseyCZ" width="100%" />
</p>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/CZ-%C4%8Ce%C5%A1tina-172033?style=for-the-badge&labelColor=111827" alt="Czech" /></a>
  <img src="https://img.shields.io/badge/EN-English-38BDF8?style=for-the-badge&labelColor=0284C7" alt="English" />
</p>

<p align="center">
  A game release calendar and search tool that shows <strong>what is coming out, when and on which platform</strong>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VERSION-v3.12.10-38BDF8?style=for-the-badge&labelColor=0284C7" alt="GameS version 3.12.10" />
</p>

<p align="center">
  <a href="https://caseycz.github.io/GameS-Calendar-Website/"><img src="https://img.shields.io/badge/Website-Open-38BDF8?style=for-the-badge&labelColor=0284C7&logo=googlechrome&logoColor=white" alt="Open GameS Calendar" /></a>
</p>

## About

**GameS Calendar** was created as a fast overview of game releases without having to browse several different websites. It lets you search for games, filter releases by platform or period, save favorites and add release dates to your calendar.

## Data quality

- live search uses IGDB and complementary official catalogs beyond the local release list
- exact dates, announced months, quarters and years are stored separately so approximate windows are not presented as confirmed days
- the website loads a compact catalog first and full metadata only when a detail view needs it
- automated quality checks cover catalog structure, duplicates, suspicious release boundaries and search regressions

## Architecture

- `games-index.json` is the compact first-load catalog; the full `games.json` remains the authoritative data source and emergency fallback
- live search and game details are served by the GameS API backed by IGDB, Steam, Xbox, PlayStation, Nintendo and GeForce NOW providers
- the rolling catalog is refreshed daily from IGDB, while deeper metadata enrichment runs separately; all catalog-writer workflows are serialized
- each release preserves its precision (`day / month / q1–q4 / year / unknown`) and precision provenance so approximate windows are never presented as confirmed dates
- CI runs syntax validation, regression smoke tests, catalog data-quality checks and compact-payload size checks

### Audit 3.11

- global IGDB search respects active platform, genre, company, series and watchlist filters
- corrected PS4 / PS5 / Xbox Series / Xbox One / Xbox 360 grouping, including IGDB's `Series X|S` label
- the compact catalog uses a sparse schema with a 3.2 MiB performance budget instead of shipping empty/default fields
- touch targets and small mobile text were improved for readability and accessibility
- catalog-writer workflows have distinct responsibilities and every data write passes regression and data-quality gates

## Main features

- 🔍 search upcoming and released games
- 🎮 filter by platform, period, genre and release status
- ❤️ keep your own favorites / watchlist
- ⏳ countdown to release
- 📖 game detail with description and key information
- 🔗 links to official sites, stores, YouTube and other sources
- 📅 add releases to Google Calendar, Apple Calendar or Outlook
- 🔁 share the current selection and filters
- 📱 comfortable on mobile and desktop

## Support

<p align="center">
  <a href="https://www.buymeacoffee.com/caseycz"><img src="https://img.shields.io/badge/Support%20CaseyCZ-Buy%20Me%20a%20Coffee-38BDF8?style=for-the-badge&labelColor=0284C7&logo=buymeacoffee&logoColor=white" alt="Support CaseyCZ" /></a>
</p>

<p align="center">
  <a href="https://www.buymeacoffee.com/caseycz"><img src="https://caseycz.github.io/support-qr.svg" width="150" alt="Buy Me a Coffee CaseyCZ QR code" /></a><br>
  <sub>Scan the QR code or click the button.</sub>
</p>

<p align="center">
  <a href="https://caseycz.github.io/"><img src="https://img.shields.io/badge/CaseyCZ%20Website-Open-172033?style=flat-square&labelColor=111827" alt="CaseyCZ Website" /></a>
</p>