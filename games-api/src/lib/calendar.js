function dayOffset(day, amount) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function escapeIcs(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldIcs(line) {
  const chunks = [];
  let current = '';
  let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    if (current && bytes + size > 75) {
      chunks.push(current);
      current = ' ';
      bytes = 1;
    }
    current += character;
    bytes += size;
  }
  chunks.push(current);
  return chunks.join('\r\n');
}

function platformGroup(name = '') {
  const value = String(name).trim().toLowerCase();
  if (value.includes('switch 2') || value === 'nsw2') return 'Switch 2';
  if (value.includes('playstation 5') || value === 'ps5') return 'PS5';
  if (value.includes('xbox') || /^(xone|x360|xsx|xb1)$/.test(value)) return 'Xbox Series';
  if (value.includes('nintendo switch') || value === 'switch' || value === 'nsw') return 'Switch';
  if (/quest|rift|steamvr|playstation vr|\bvr\b|virtual reality/.test(value)) return 'VR';
  if (/\bpc\b|windows|linux|mac|steam|^win$/.test(value)) return 'PC';
  return 'Other';
}

function cleanValues(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source.map(item => String(item).trim()).filter(Boolean))];
}

function textMatches(values, filters) {
  if (!filters.length) return true;
  const available = new Set(cleanValues(values).map(value => value.toLocaleLowerCase('cs')));
  return filters.some(value => available.has(value.toLocaleLowerCase('cs')));
}

function gameMatches(game, options) {
  if (options.ids.length && !options.ids.includes(String(game.id))) return false;
  if (!textMatches(game.genres, options.genres)) return false;
  if (options.developer && !cleanValues(game.developers).includes(options.developer)) return false;
  if (options.publisher && !cleanValues(game.publishers).includes(options.publisher)) return false;
  if (options.series && !cleanValues(game.series).includes(options.series)) return false;
  return true;
}

function normalizedOptions(options = {}) {
  return {
    ids: cleanValues(options.ids).slice(0, 500),
    platforms: cleanValues(options.platforms),
    genres: cleanValues(options.genres),
    developer: String(options.developer || '').trim(),
    publisher: String(options.publisher || '').trim(),
    series: String(options.series || '').trim(),
    status: ['upcoming', 'released', 'all'].includes(options.status) ? options.status : 'upcoming',
    from: /^\d{4}-\d{2}-\d{2}$/.test(options.from || '') ? options.from : '',
    to: /^\d{4}-\d{2}-\d{2}$/.test(options.to || '') ? options.to : '',
    today: /^\d{4}-\d{2}-\d{2}$/.test(options.today || '') ? options.today : new Date().toISOString().slice(0, 10),
    generatedAt: options.generatedAt || new Date().toISOString(),
    webBaseUrl: String(options.webBaseUrl || '').replace(/\/$/, ''),
    name: String(options.name || 'Herní Kalendář').slice(0, 100)
  };
}

export function releaseRows(games, input = {}) {
  const options = normalizedOptions(input);
  const grouped = new Map();

  for (const game of games || []) {
    if (!gameMatches(game, options)) continue;
    for (const release of game.releases || []) {
      const day = String(release?.date || release?.day || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (options.status === 'upcoming' && day < options.today) continue;
      if (options.status === 'released' && day >= options.today) continue;
      if (options.from && day < options.from) continue;
      if (options.to && day > options.to) continue;

      const platforms = cleanValues((release.platforms || []).map(item => typeof item === 'string' ? item : item?.name || item?.abbreviation));
      const groups = [...new Set(platforms.map(platformGroup))];
      if (options.platforms.length && !groups.some(group => options.platforms.includes(group))) continue;

      const key = `${String(game.id)}|${day}`;
      if (!grouped.has(key)) grouped.set(key, { game, day, platforms: new Set() });
      platforms.forEach(platform => grouped.get(key).platforms.add(platform));
    }
  }

  return [...grouped.values()]
    .map(row => ({ ...row, platforms: [...row.platforms].sort((a, b) => a.localeCompare(b, 'cs')) }))
    .sort((a, b) => a.day.localeCompare(b.day) || String(a.game.name).localeCompare(String(b.game.name), 'cs'));
}

export function buildCalendarFeed(games, input = {}) {
  const options = normalizedOptions(input);
  const rows = releaseRows(games, options);
  const parsedStamp = Date.parse(options.generatedAt);
  const stamp = new Date(Number.isFinite(parsedStamp) ? parsedStamp : Date.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GameS Calendar//CZ',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(options.name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H'
  ];

  for (const row of rows) {
    const start = row.day.replace(/-/g, '');
    const end = dayOffset(row.day, 1).replace(/-/g, '');
    const game = row.game;
    const detailUrl = options.webBaseUrl
      ? `${options.webBaseUrl}/?game=${encodeURIComponent(String(game.id))}`
      : (game.links?.official || game.links?.igdb || game.igdbUrl || '');
    const description = [
      row.platforms.length ? `Platformy: ${row.platforms.join(', ')}` : '',
      game.summary || '',
      detailUrl
    ].filter(Boolean).join('\n\n');
    const safeId = String(game.id).replace(/[^a-zA-Z0-9_-]/g, '_');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${safeId}-${start}@games-calendar`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${escapeIcs(game.name)}`,
      `DESCRIPTION:${escapeIcs(description)}`,
      'STATUS:CONFIRMED',
      'TRANSP:TRANSPARENT'
    );
    if (detailUrl) lines.push(`URL:${escapeIcs(detailUrl)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return { body: `${lines.map(foldIcs).join('\r\n')}\r\n`, count: rows.length };
}

export const calendarInternals = { dayOffset, escapeIcs, foldIcs, platformGroup };
