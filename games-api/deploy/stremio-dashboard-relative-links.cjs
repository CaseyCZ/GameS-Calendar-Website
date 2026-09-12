#!/usr/bin/env node
'use strict';

const fs = require('fs');

const file = process.argv[2] || '/home/ubuntu/stremio-dashboard/index.js';
if (!fs.existsSync(file)) {
  console.error(`Dashboard file not found: ${file}`);
  process.exit(1);
}

let text = fs.readFileSync(file, 'utf8');
const original = text;

const WEB_LINKS = {
  'stremio-sosac': '/stremio-sosac/manifest.json',
  'stremio-subtitles': '/stremio-sosac-subtitles/manifest.json',
  'stremio-dashboard': '/dashboard/',
  'games-api': '/games/'
};

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

for (const [name, web] of Object.entries(WEB_LINKS)) {
  const blockRe = new RegExp(`('${escapeRegex(name)}'\\s*:\\s*\\{)([\\s\\S]*?)(\\n\\s*\\})`);
  const match = text.match(blockRe);
  if (!match) {
    throw new Error(`APPS entry not found: ${name}`);
  }

  let body = match[2];
  if (/\n\s*web\s*:\s*['"][^'"]*['"]\s*,?/.test(body)) {
    body = body.replace(/(\n\s*web\s*:\s*)['"][^'"]*['"](\s*,?)/, `$1'${web}'$2`);
  } else {
    const trimmed = body.replace(/\s*$/, '');
    const needsComma = trimmed.trim().length > 0 && !trimmed.trimEnd().endsWith(',');
    body = `${trimmed}${needsComma ? ',' : ''}\n    web: '${web}'`;
  }

  text = text.replace(blockRe, `${match[1]}${body}${match[3]}`);
}

if (text === original) {
  console.log('Dashboard app web links are already normalized.');
  process.exit(0);
}

const backup = `${file}.backup-links-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(file, backup);
fs.writeFileSync(file, text);
console.log(`Dashboard web links updated: ${file}`);
console.log(`Backup: ${backup}`);
