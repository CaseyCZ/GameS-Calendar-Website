<p align="center">
  <img src="assets/games-readme-header.svg" alt="GameS Calendar by CaseyCZ" width="100%" />
</p>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/CZ-%C4%8Ce%C5%A1tina-172033?style=for-the-badge&labelColor=111827" alt="Czech" /></a>
  <a href="README_EN.md"><img src="https://img.shields.io/badge/EN-English-38BDF8?style=for-the-badge&labelColor=0284C7" alt="English" /></a>
</p>

<p align="center">
  A clean game release calendar and search tool for upcoming and released games. Quickly see <strong>what is coming out, when it releases and on which platform</strong>.
</p>

<p align="center">
  <a href="https://130.61.49.108/games/"><img src="https://img.shields.io/badge/GameS%20Calendar-OPEN-38BDF8?style=for-the-badge&labelColor=0284C7" alt="Open GameS Calendar" /></a>
  <a href="https://caseycz.github.io/"><img src="https://img.shields.io/badge/CaseyCZ%20Website-OPEN-38BDF8?style=for-the-badge&labelColor=0284C7" alt="CaseyCZ Website" /></a>
  <a href="https://www.buymeacoffee.com/caseycz"><img src="https://img.shields.io/badge/Support%20CaseyCZ-OPEN-38BDF8?style=for-the-badge&labelColor=0284C7&logo=buymeacoffee&logoColor=white" alt="Support CaseyCZ" /></a>
</p>

## What GameS can do

| Feature | Description |
| --- | --- |
| 🔍 **Search** | Search the local catalog and IGDB, including titles not cached locally yet. |
| 🎮 **Platforms** | Filter PC, PlayStation, Xbox, Nintendo and other platforms. |
| 🗓️ **Releases** | Browse by month, release date, status and genre. |
| ❤️ **Favorites** | Keep your own list of followed games. |
| ⏳ **Countdowns** | See how much time remains until release. |
| 📖 **Game details** | Description, genre, developer, publisher, rating, covers and other metadata. |
| 🔗 **External sources** | Links to stores, official sites, databases, Reddit and YouTube. |
| 📅 **Calendar** | Add one or multiple releases to Google Calendar, Apple Calendar or Outlook. |
| 🔁 **Sharing** | Share the current selection and filters through a URL. |
| 📱 **Responsive UI** | Comfortable on desktop and mobile. |

## Links & API

<table>
  <thead><tr><th>Service</th><th>Address</th><th>Action</th></tr></thead>
  <tbody>
    <tr><td><strong>GameS website</strong></td><td><code>130.61.49.108/games/</code></td><td><a href="https://130.61.49.108/games/"><img src="https://img.shields.io/badge/Web-OPEN-38BDF8?style=flat-square&labelColor=0284C7" alt="Open website" /></a></td></tr>
    <tr><td><strong>Catalog API</strong></td><td><code>/games-api/catalog</code></td><td><a href="https://130.61.49.108/games-api/catalog"><img src="https://img.shields.io/badge/API-OPEN-38BDF8?style=flat-square&labelColor=0284C7" alt="Open API" /></a></td></tr>
    <tr><td><strong>API health</strong></td><td><code>/games-health</code></td><td><a href="https://130.61.49.108/games-health"><img src="https://img.shields.io/badge/Health-OPEN-38BDF8?style=flat-square&labelColor=0284C7" alt="Open health endpoint" /></a></td></tr>
  </tbody>
</table>

The same paths are also available on HTTPS port `8443`.

## How the data works

The website loads a compact list for cards and filters first. Full game details are fetched only when a game is opened, and later visits only check the catalog version through `/games-api/catalog-meta`.

GitHub Pages uses the static `games.json`. The self-hosted server can additionally enrich game details live from **IGDB** and official stores. Updating the catalog in GitHub does not automatically update the server copy.

Online search checks both the full local catalog and IGDB. Missing records are stored after loading for faster later access, and longer result sets are progressively revealed.

## How to use GameS

Choose a platform or time period, or search by game name. Results immediately adapt to the active filters.

Open a game to see details, external links, add it to favorites, or save its release date to your calendar. Filters can be combined and the resulting selection can be shared through a URL.

## Catalog updates

Metadata used for cards and filters is stored in `games.json`. On the server it can be refreshed with:

```bash
npm run enrich-igdb
```

IGDB credentials stay in `games-api/.env`. The GitHub workflow performs the same enrichment only when `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` secrets are configured.

Release dates, platforms and other metadata may change as new information becomes available.

## Why GameS exists

There are many game releases every month, and tracking dates across several websites is inconvenient. GameS is designed as one fast place to answer four questions:

> **What is coming out? When? On what platform? And where can I learn more?**

## Technology

<p>
  <img src="https://img.shields.io/badge/JavaScript-111827?style=flat-square&logo=javascript&logoColor=38BDF8" alt="JavaScript" />
  <img src="https://img.shields.io/badge/HTML5-111827?style=flat-square&logo=html5&logoColor=38BDF8" alt="HTML5" />
  <img src="https://img.shields.io/badge/CSS3-111827?style=flat-square&logo=css3&logoColor=38BDF8" alt="CSS3" />
  <img src="https://img.shields.io/badge/Node.js-111827?style=flat-square&logo=nodedotjs&logoColor=38BDF8" alt="Node.js" />
  <img src="https://img.shields.io/badge/IGDB-111827?style=flat-square&logoColor=38BDF8" alt="IGDB" />
  <img src="https://img.shields.io/badge/GitHub-111827?style=flat-square&logo=github&logoColor=38BDF8" alt="GitHub" />
</p>

## CaseyCZ

<p align="center">
  <a href="https://caseycz.github.io/"><img src="https://img.shields.io/badge/CaseyCZ%20Website-OPEN-38BDF8?style=for-the-badge&labelColor=0284C7" alt="CaseyCZ Website" /></a>
  <a href="https://www.buymeacoffee.com/caseycz"><img src="https://img.shields.io/badge/Support%20CaseyCZ-Buy%20Me%20a%20Coffee-38BDF8?style=for-the-badge&labelColor=0284C7&logo=buymeacoffee&logoColor=white" alt="Support CaseyCZ" /></a>
</p>