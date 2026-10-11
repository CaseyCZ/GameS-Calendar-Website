import fs from 'node:fs';
import webpush from 'web-push';

const file = process.argv[2] || '.env';
let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const value = key => (text.match(new RegExp(`^${key}=(.+)$`, 'm')) || [])[1]?.trim() || '';
if (value('VAPID_PUBLIC_KEY') && value('VAPID_PRIVATE_KEY')) process.exit(0);

const keys = webpush.generateVAPIDKeys();
function set(key, next) {
  const line = `${key}=${next}`;
  if (new RegExp(`^${key}=.*$`, 'm').test(text)) text = text.replace(new RegExp(`^${key}=.*$`, 'm'), line);
  else text += `${text.endsWith('\n') || !text ? '' : '\n'}${line}\n`;
}
set('VAPID_PUBLIC_KEY', keys.publicKey);
set('VAPID_PRIVATE_KEY', keys.privateKey);
if (!value('VAPID_SUBJECT')) set('VAPID_SUBJECT', 'https://caseycz.github.io/GameS-Calendar-Website/');
fs.writeFileSync(file, text, { mode:0o600 });
console.log('Created server-only web push keys.');
