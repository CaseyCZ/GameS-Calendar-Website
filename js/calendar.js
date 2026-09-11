import { addDays } from './data.js';

function escapeIcs(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldIcs(line) {
  const encoder = new TextEncoder();
  let out = '';
  let chunk = '';
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) {
      out += `${chunk}\r\n `;
      chunk = '';
      bytes = 1;
    }
    chunk += char;
    bytes += size;
  }
  return out + chunk;
}

export function buildIcs(rows) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GameS Calendar//CZ',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  for (const row of rows) {
    const start = row.day.replace(/-/g, '');
    const end = addDays(row.day, 1).replace(/-/g, '');
    const game = row.game;
    const platforms = row.platforms.map(p => p.name).join(', ');
    const description = [platforms && `Platformy: ${platforms}`, game.summary].filter(Boolean).join('\n\n');
    const uid = `${String(game.id).replace(/[^a-zA-Z0-9_-]/g, '_')}-${start}@games-calendar`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${escapeIcs(game.name)}`,
      `DESCRIPTION:${escapeIcs(description)}`
    );
    if (game.links?.official || game.links?.igdb) lines.push(`URL:${escapeIcs(game.links.official || game.links.igdb)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcs).join('\r\n') + '\r\n';
}

export function downloadIcs(rows, filename = 'herni-kalendar.ics') {
  if (!rows.length) return false;
  const blob = new Blob([buildIcs(rows)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export function googleCalendarUrl(row) {
  const start = row.day.replace(/-/g, '');
  const end = addDays(row.day, 1).replace(/-/g, '');
  const game = row.game;
  const details = [
    row.platforms.length ? `Platformy: ${row.platforms.map(p => p.name).join(', ')}` : '',
    game.summary || '',
    game.links?.official || game.links?.igdb || ''
  ].filter(Boolean).join('\n\n');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: game.name,
    dates: `${start}/${end}`,
    details
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
