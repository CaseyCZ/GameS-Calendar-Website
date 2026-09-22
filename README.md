<p align="center">
  <img src="assets/games-readme-header.svg" alt="GameS Calendar by CaseyCZ" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/CZ-%C4%8Ce%C5%A1tina-38BDF8?style=for-the-badge&labelColor=0284C7" alt="Čeština" />
  <a href="README_EN.md"><img src="https://img.shields.io/badge/EN-English-172033?style=for-the-badge&labelColor=111827" alt="English" /></a>
</p>

<p align="center">
  Herní kalendář a vyhledávač, který na jednom místě ukazuje <strong>co vychází, kdy a na jaké platformě</strong>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VERZE-v3.11.4-38BDF8?style=for-the-badge&labelColor=0284C7" alt="GameS verze 3.11.4" />
</p>

<p align="center">
  <a href="https://caseycz.github.io/GameS-Calendar-Website/"><img src="https://img.shields.io/badge/Web-Otev%C5%99%C3%ADt-38BDF8?style=for-the-badge&labelColor=0284C7&logo=googlechrome&logoColor=white" alt="Otevřít GameS Calendar" /></a>
</p>

## O projektu

**GameS Calendar** vznikl jako rychlý přehled herních vydání bez nutnosti procházet několik různých webů. Umožňuje vyhledat hru, filtrovat vydání podle platformy nebo období, uložit oblíbené tituly a přidat datum vydání do kalendáře.

## Data a kvalita

- živé hledání používá IGDB a doplňkové oficiální katalogy i mimo lokální seznam her
- přesné datum, oznámený měsíc, čtvrtletí a rok se vedou odděleně, aby se orientační termín netvářil jako potvrzený den
- web načítá zmenšený katalog pro rychlé zobrazení a plná metadata až při otevření detailu
- automatické kontroly hlídají strukturu katalogu, duplicity, podezřelé termíny a regresní scénáře vyhledávání

## Architektura

- `games-index.json` je kompaktní katalog pro rychlé první načtení; plný `games.json` zůstává datovým zdrojem a nouzovým fallbackem
- živé vyhledávání a detail hry obsluhuje GameS API s IGDB, Steam, Xbox, PlayStation, Nintendo a GeForce NOW providery
- katalog se lehce obnovuje denně z IGDB; hlubší obohacení metadat běží samostatně a všechny workflow zapisující katalog jsou serializované
- release záznam nese vlastní přesnost (`day / month / q1–q4 / year / unknown`) a původ této přesnosti, aby orientační termíny nebyly prezentované jako potvrzené datum
- CI spouští syntax check, regresní smoke testy, datový audit a kontrolu velikosti kompaktního katalogu

### Audit 3.11

- vyhledávání respektuje aktivní platformy, žánry, studio, sérii a sledované hry i při globálním IGDB hledání
- opravené rozlišení PS4 / PS5 / Xbox Series / Xbox One / Xbox 360 včetně názvu IGDB `Series X|S`
- kompaktní katalog používá sparse schéma a má výkonový limit 3,2 MiB; prázdná/defaultní pole už se neposílají
- mobilní ovládání má větší dotykové cíle a čitelnější malé texty
- writer workflow jsou oddělené podle odpovědnosti a každý zápis dat prochází regresními a datovými kontrolami

## Hlavní funkce

- 🔍 vyhledávání připravovaných i vydaných her
- 🎮 filtry podle platformy, období, žánru a stavu vydání
- ❤️ vlastní seznam oblíbených / sledovaných her
- ⏳ odpočet do vydání
- 📖 detail hry s popisem a důležitými informacemi
- 🔗 odkazy na oficiální stránky, obchody, YouTube a další zdroje
- 📅 přidání vydání do Google Calendar, Apple Calendar nebo Outlooku
- 🔁 sdílení aktuálního výběru a filtrů
- 📱 pohodlné použití na telefonu i desktopu

## Podpora

<p align="center">
  <a href="https://www.buymeacoffee.com/caseycz"><img src="https://img.shields.io/badge/Podpo%C5%99it%20CaseyCZ-Buy%20Me%20a%20Coffee-38BDF8?style=for-the-badge&labelColor=0284C7&logo=buymeacoffee&logoColor=white" alt="Podpořit CaseyCZ" /></a>
</p>

<p align="center">
  <a href="https://www.buymeacoffee.com/caseycz"><img src="https://caseycz.github.io/support-qr.svg" width="150" alt="QR kód Buy Me a Coffee CaseyCZ" /></a><br>
  <sub>Naskenuj QR kód nebo klikni na tlačítko.</sub>
</p>

<p align="center">
  <a href="https://caseycz.github.io/"><img src="https://img.shields.io/badge/CaseyCZ%20Website-Otev%C5%99%C3%ADt-172033?style=flat-square&labelColor=111827" alt="CaseyCZ Website" /></a>
</p>