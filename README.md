# 🎮 GameS Calendar

**Přehledný herní kalendář a vyhledávač připravovaných i vydaných her.**

GameS Calendar vznikl pro každého, kdo chce mít rychle jasno v tom, **co vychází, kdy to vychází a na jaké platformě** — bez zdlouhavého hledání na několika různých webech.

## 🌐 Otevřít web

👉 **https://caseycz.github.io/GameS-Calendar-Website/**

## Vlastní server

- Web: https://130.61.49.108/games/
- Katalog: https://130.61.49.108/games-api/catalog
- Stav API: https://130.61.49.108/games-health

Stejné cesty fungují také na HTTPS portu 8443. Web načte společný katalog jednou a při dalších návštěvách ověří jen jeho malou verzi přes `/games-api/catalog-meta`. GitHub Pages používá stejný statický `games.json`; vlastní server nabízí navíc živé doplnění detailu z IGDB a oficiálních obchodů. Aktualizace katalogu v GitHubu sama neaktualizuje kopii na serveru.

## ✨ Co na webu najdete

- 🔍 **Rychlé vyhledávání her podle názvu**
- 🎮 **Filtrování podle platforem** — PC, PlayStation, Xbox, Nintendo a další
- 🗓️ **Přehled podle měsíců a data vydání**
- 🎯 **Filtry podle žánru a stavu vydání**
- ❤️ **Sledované / oblíbené hry** pro vlastní seznam
- ⏳ **Odpočet do vydání** u připravovaných titulů
- 🖼️ **Obaly her a přehledné karty**
- 📖 **Detail hry** s popisem, žánrem, vývojářem, vydavatelem a hodnocením
- 🔗 **Odkazy na herní obchody, oficiální stránky, databázi hry, Reddit a YouTube**
- 📅 **Přidání hry do kalendáře** — Google Calendar, Apple Calendar nebo Outlook
- 📥 **Stažení více vybraných vydání do kalendáře najednou**
- 🔗 **Sdílení aktuálního výběru a filtrů pomocí odkazu**
- 🇨🇿 **České prostředí a český formát data**
- 📱 **Pohodlné použití na počítači i telefonu**

## 🕹️ Jak GameS Calendar používat

Vyberte platformu nebo období, případně napište název hry do vyhledávání. Výsledky se okamžitě přizpůsobí vašemu výběru.

Kliknutím na hru otevřete její detail, kde najdete další informace a odkazy. Hru si můžete uložit mezi sledované nebo ji rovnou přidat do svého kalendáře, abyste na vydání nezapomněli.

Pokud chcete vidět jen hry, které vás skutečně zajímají, můžete kombinovat více filtrů současně.

## ❤️ Proč projekt vznikl

Herních vydání je každý měsíc velké množství a sledovat všechny termíny na různých stránkách je nepraktické. Cílem GameS Calendar je nabídnout **jedno rychlé a přehledné místo**, kde se dá během několika sekund zjistit:

> **Co vychází? Kdy? Na čem? A kde si o hře zjistím víc?**

## 🔄 Aktuální informace

Metadata pro seznam a filtry se pravidelně ukládají do `games.json`. Na serveru je lze bezpečně obnovit příkazem `npm run enrich-igdb`; přístupové údaje IGDB zůstávají v souboru `games-api/.env`. GitHub workflow provede stejný krok pouze při nastavení tajných hodnot `IGDB_CLIENT_ID` a `IGDB_CLIENT_SECRET`.

Přehled her je průběžně aktualizovaný, takže se mohou měnit data vydání, platformy i další informace podle toho, jak jsou zveřejňovány nové údaje o hrách.

---

### 🎮 Najděte si svou další hru

👉 **https://caseycz.github.io/GameS-Calendar-Website/**
