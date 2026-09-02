const fs = require('fs');

const CLIENT_ID = 'r5sr40kapta9eorzmr4zlmtqyepa1b';
const CLIENT_SECRET = 'cdwhzrnwgypkkxxg6pk7coe961m8xl';

// Seznam slov, která identifikují edice, DLC nebo nechtěné verze v názvu hry
const EXCLUDED_KEYWORDS = [
    'edition', 'bundle', 'pack', 'dlc', 'expansion', 'season pass', 
    'demo', 'playtest', 'beta', 'soundtrack', 'artbook', 'upgrade',
    'collector', 'deluxe', 'goty', 'game of the year', 'ultimate', 'complete'
];

function isUnwantedEdition(gameName) {
    const lowerName = gameName.toLowerCase();
    return EXCLUDED_KEYWORDS.some(keyword => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        return regex.test(lowerName);
    });
}

async function getGames() {
    try {
        console.log('Získávám přístupový token...');
        const tokenResponse = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`, {
            method: 'POST'
        });

        const tokenData = await tokenResponse.json();
        
        if (!tokenData.access_token) {
            console.error('Chyba: Nepodařilo se získat token.', tokenData);
            return;
        }

        const ACCESS_TOKEN = tokenData.access_token;
        console.log('Token úspěšně získán! Stahuji data...');

        const allReleases = [];
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const numOfMonths = 12;

        for (let i = 0; i < numOfMonths; i++) {
            const targetDate = new Date(currentYear, currentMonth + i, 1);
            const year = targetDate.getFullYear();
            const month = targetDate.getMonth();

            const startDateObj = new Date(Date.UTC(year, month, 1, 0, 0, 0));
            const endDateObj = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));

            const rangeStart = Math.floor(startDateObj.getTime() / 1000);
            const rangeEnd = Math.floor(endDateObj.getTime() / 1000);

            console.log(`Stahování měsíce ${i + 1}/${numOfMonths}...`);

            let offset = 0;
            let fetchMore = true;

            while (fetchMore) {
                const query = `
                    fields date, game.name, game.cover.url, game.game_type, platform.name, game.version_parent, game.parent_game;
                    where date >= ${rangeStart} & date <= ${rangeEnd} & game.game_type = 0 & game.version_parent = null & game.parent_game = null & platform = (6, 167, 169, 130);
                    sort date asc;
                    limit 500;
                    offset ${offset};
                `;

                const response = await fetch('https://api.igdb.com/v4/release_dates', {
                    method: 'POST',
                    headers: {
                        'Client-ID': CLIENT_ID,
                        'Authorization': `Bearer ${ACCESS_TOKEN}`,
                        'Accept': 'application/json',
                        'Content-Type': 'text/plain'
                    },
                    body: query
                });

                const data = await response.json();
                if (Array.isArray(data)) {
                    if (data.length > 0) {
                        allReleases.push(...data);
                        offset += 500;
                        if (data.length < 500) fetchMore = false;
                    } else {
                        fetchMore = false;
                    }
                } else {
                    fetchMore = false;
                }
                
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }

        // Zpracování, úprava URL obrázků a textová filtrace edic
        const formattedData = allReleases
            .filter(item => {
                if (!item.game || !item.game.name) return false;
                return !isUnwantedEdition(item.game.name);
            })
            .map(item => {
                if (item.game && item.game.cover && item.game.cover.url) {
                    let url = item.game.cover.url;
                    if (url.startsWith('//')) url = 'https:' + url;
                    item.game.cover.url = url.replace(/\/t_[a-z0-9_]+\//, '/t_cover_big/');
                }
                return item;
            });

        // Deduplikace: Každá hra se v daný den objeví pouze jednou a platformy se sloučí do pole
        const uniqueReleases = {};
        formattedData.forEach(item => {
            if (item.game && item.date) {
                const gameId = item.game.id;
                const date = item.date;
                const key = `${gameId}_${date}`;

                if (!uniqueReleases[key]) {
                    uniqueReleases[key] = {
                        ...item,
                        platforms: item.platform ? [item.platform.name] : []
                    };
                    delete uniqueReleases[key].platform;
                } else {
                    if (item.platform && !uniqueReleases[key].platforms.includes(item.platform.name)) {
                        uniqueReleases[key].platforms.push(item.platform.name);
                    }
                }
            }
        });

        const finalData = Object.values(uniqueReleases).sort((a, b) => a.date - b.date);

        fs.writeFileSync('games.json', JSON.stringify(finalData, null, 2));
        console.log(`Hotovo! Uloženo ${finalData.length} unikátních her bez edic a duplicit.`);

    } catch (error) {
        console.error('Chyba:', error);
    }
}

getGames();