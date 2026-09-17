<p align="center">
  <img src="assets/games-readme-header.svg" alt="GameS Calendar by CaseyCZ" width="100%" />
</p>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/CZ-%C4%8Ce%C5%A1tina-38BDF8?style=for-the-badge&labelColor=0284C7" alt="Čeština" /></a>
  <a href="README_EN.md"><img src="https://img.shields.io/badge/EN-English-172033?style=for-the-badge&labelColor=111827" alt="English" /></a>
</p>

<p align="center">
  Přehledný herní kalendář a vyhledávač připravovaných i vydaných her. Rychle zjistíš <strong>co vychází, kdy to vychází a na jaké platformě</strong>.
</p>

<p align="center">
  <a href="https://130.61.49.108/games/"><img src="https://img.shields.io/badge/GameS%20Calendar-OTEV%C5%98%C3%8DT-38BDF8?style=for-the-badge&labelColor=0284C7" alt="Otevřít GameS Calendar" /></a>
  <a href="https://caseycz.github.io/"><img src="https://img.shields.io/badge/CaseyCZ%20Website-OTEV%C5%98%C3%8DT-38BDF8?style=for-the-badge&labelColor=0284C7" alt="CaseyCZ Website" /></a>
  <a href="https://www.buymeacoffee.com/caseycz"><img src="https://img.shields.io/badge/Podpo%C5%99it%20CaseyCZ-OTEV%C5%98%C3%8DT-38BDF8?style=for-the-badge&labelColor=0284C7&logo=buymeacoffee&logoColor=white" alt="Podpořit CaseyCZ" /></a>
</p>

## Co GameS umí

| Funkce | Popis |
| --- | --- |
| 🔍 **Vyhledávání** | Hledání v lokálním katalogu i online přes IGDB, včetně chybějících titulů. |
| 🎮 **Platformy** | Filtrování PC, PlayStation, Xbox, Nintendo a dalších platforem. |
| 🗓️ **Vydání** | Přehled podle měsíců, data vydání, stavu a žánru. |
| ❤️ **Oblíbené hry** | Vlastní seznam sledovaných titulů. |
| ⏳ **Odpočty** | Přehled času zbývajícího do vydání. |
| 📖 **Detail hry** | Popis, žánr, vývojář, vydavatel, hodnocení, obaly a další metadata. |
| 🔗 **Externí zdroje** | Odkazy na obchody, oficiální weby, databáze, Reddit a YouTube. |
| 📅 **Kalendář** | Přidání jedné nebo více her do Google Calendar, Apple Calendar nebo Outlooku. |
| 🔁 **Sdílení** | Sdílení aktuálního výběru a filtrů pomocí odkazu. |
| 📱 **Responsive UI** | Pohodlné použití na desktopu i telefonu. |

## Odkazy & API

<table>
  <thead><tr><th>Služba</th><th>Adresa</th><th>Akce</th></tr></thead>
  <tbody>
    <tr><td><strong>GameS web</strong></td><td><code>130.61.49.108/games/</code></td><td><a href="https://130.61.49.108/games/"><img src="https://img.shields.io/badge/Web-OTEV%C5%98%C3%8DT-38BDF8?style=flat-square&labelColor=0284C7" alt="Otevřít web" /></a></td></tr>
    <tr><td><strong>Katalog API</strong></td><td><code>/games-api/catalog</code></td><td><a href="https://130.61.49.108/games-api/catalog"><img src="https://img.shields.io/badge/API-OTEV%C5%98%C3%8DT-38BDF8?style=flat-square&labelColor=0284C7" alt="Otevřít API" /></a></td></tr>
    <tr><td><strong>Stav API</strong></td><td><code>/games-health</code></td><td><a href="https://130.61.49.108/games-health"><img src="https://img.shields.io/badge/Health-OTEV%C5%98%C3%8DT-38BDF8?style=flat-square&labelColor=0284C7" alt="Otevřít health endpoint" /></a></td></tr>
  </tbody>
</table>

Stejné cesty fungují také na HTTPS portu `8443`.

## Jak data fungují

Web při běžném načtení stáhne malý seznam potřebný pro karty a filtry. Plný detail hry se načte až po jejím otevření a při dalších návštěvách se kontroluje pouze verze katalogu přes `/games-api/catalog-meta`.

GitHub Pages používá statický `games.json`. Vlastní server navíc umí živě doplnit detail z **IGDB** a oficiálních obchodů. Aktualizace katalogu v GitHubu sama neaktualizuje serverovou kopii.

Online vyhledávání kontroluje celý místní katalog i IGDB. Chybějící záznamy se po načtení uloží pro rychlejší další otevření a delší výsledky se zobrazují postupně.

## Jak GameS používat

Vyber platformu nebo období, případně napiš název hry. Výsledky se okamžitě přizpůsobí aktivním filtrům.

Po otevření hry získáš detail, odkazy na další zdroje, možnost uložit titul mezi oblíbené a přidat datum vydání do kalendáře. Filtry lze kombinovat a výsledný výběr sdílet odkazem.

## Aktualizace katalogu

Metadata pro seznam a filtry se ukládají do `games.json`. Na serveru je lze obnovit příkazem:

```bash
npm run enrich-igdb
```

Přístupové údaje IGDB zůstávají v `games-api/.env`. GitHub workflow provede stejný krok pouze při nastavení tajných hodnot `IGDB_CLIENT_ID` a `IGDB_CLIENT_SECRET`.

Data vydání, platformy a další metadata se mohou průběžně měnit podle nově zveřejněných informací.

## Proč GameS vznikl

Herních vydání je každý měsíc velké množství a sledovat termíny na několika různých webech je nepraktické. GameS má být jedno rychlé místo pro odpověď na čtyři otázky:

> **Co vychází? Kdy? Na čem? A kde si o hře zjistím víc?**

## Technologie

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
  <a href="https://caseycz.github.io/"><img src="https://img.shields.io/badge/CaseyCZ%20Website-OTEV%C5%98%C3%8DT-38BDF8?style=for-the-badge&labelColor=0284C7" alt="CaseyCZ Website" /></a>
  <a href="https://www.buymeacoffee.com/caseycz"><img src="https://img.shields.io/badge/Podpo%C5%99it%20CaseyCZ-Buy%20Me%20a%20Coffee-38BDF8?style=for-the-badge&labelColor=0284C7&logo=buymeacoffee&logoColor=white" alt="Podpořit CaseyCZ" /></a>
</p>