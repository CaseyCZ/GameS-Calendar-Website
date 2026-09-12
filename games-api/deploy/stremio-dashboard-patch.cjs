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

function replaceOnce(label, before, after) {
  if (text.includes(after)) return;
  if (!text.includes(before)) {
    throw new Error(`Cannot patch ${label}: expected source block was not found`);
  }
  text = text.replace(before, after);
}

replaceOnce('APPS games-api', `  'stremio-dashboard': {
    repo: '/home/ubuntu/stremio-dashboard'
  }
};`, `  'stremio-dashboard': {
    repo: '/home/ubuntu/stremio-dashboard'
  },
  'games-api': {
    repo: '/home/ubuntu/games-calendar/repo/games-api'
  }
};`);

replaceOnce('GameS API health helper', `app.get('/api/status', async (req, res) => {`, `async function gamesApiHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch('http://127.0.0.1:8787/health', { signal: controller.signal });
    const data = await response.json();
    const cached = Array.isArray(data?.cached) ? data.cached : [];
    return {
      online: response.ok || response.status === 207,
      cached,
      providersOk: cached.filter(item => item?.ok).length,
      providersTotal: cached.length
    };
  } catch (error) {
    return { online:false, cached:[], providersOk:0, providersTotal:0, error:error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/status', async (req, res) => {`);

replaceOnce('status provider data', `  const [mainGit, subGit, dashGit, cert, nginx] =
    await Promise.all([
      gitInfo(APPS['stremio-sosac'].repo),
      gitInfo(APPS['stremio-subtitles'].repo),
      gitInfo(APPS['stremio-dashboard'].repo),
      certInfo(),
      run('systemctl', ['is-active', 'nginx'])
    ]);`, `  const [mainGit, subGit, dashGit, gamesGit, gamesHealth, cert, nginx] =
    await Promise.all([
      gitInfo(APPS['stremio-sosac'].repo),
      gitInfo(APPS['stremio-subtitles'].repo),
      gitInfo(APPS['stremio-dashboard'].repo),
      gitInfo(APPS['games-api'].repo),
      gamesApiHealth(),
      certInfo(),
      run('systemctl', ['is-active', 'nginx'])
    ]);`);

replaceOnce('status response GameS fields', `    git: {
      main: mainGit,
      subtitles: subGit,
      dashboard: dashGit
    },
    cert,`, `    git: {
      main: mainGit,
      subtitles: subGit,
      dashboard: dashGit,
      games: gamesGit
    },
    gamesApi: gamesHealth,
    cert,`);

replaceOnce('GameS special update', `  if (!APPS[name] || name === 'stremio-dashboard') {
    return res.status(404).json({ ok:false });
  }

  const repo = APPS[name].repo;`, `  if (!APPS[name] || name === 'stremio-dashboard') {
    return res.status(404).json({ ok:false });
  }

  if (name === 'games-api') {
    const deploy = await run(
      '/home/ubuntu/games-calendar/repo/games-api/deploy/stremio-server-update.sh',
      [],
      { timeout:180000 }
    );
    return res.json(deploy);
  }

  const repo = APPS[name].repo;`);

replaceOnce('GameS audit action', `app.post('/api/action/update-all', async (req,res) => {`, `app.post('/api/action/audit-games', async (req,res) => {
  const result = await run(
    'npm',
    ['run', 'audit'],
    { cwd:'/home/ubuntu/games-calendar/repo/games-api', timeout:180000 }
  );
  res.json(result);
});

app.post('/api/action/update-all', async (req,res) => {`);

replaceOnce('GameS logs button', `  <button onclick="logs('stremio-dashboard')">Dashboard</button>`, `  <button onclick="logs('stremio-dashboard')">Dashboard</button>
  <button onclick="logs('games-api')">GameS API</button>`);

replaceOnce('GameS card rendering', `   if(p.name==='stremio-sosac') git=d.git.main;
   if(p.name==='stremio-subtitles') git=d.git.subtitles;
   if(p.name==='stremio-dashboard') git=d.git.dashboard;

   return '<div class="card">'+
    '<div class="app">📦 '+escapeHtml(p.name)+'</div>'+
    '<div class="'+(p.status==='online'?'online':'offline')+'">● '+escapeHtml(p.status)+'</div>'+
    '<br>CPU: '+p.cpu+' %'+
    '<br>RAM: '+p.memory+' MB'+
    '<br>Uptime: '+fmtUptime(p.uptime)+
    '<br>Restarty: '+p.restarts+
    (git?'<br>Verze: '+escapeHtml(git.version)+
    '<br>Git: '+escapeHtml(git.branch)+' / '+escapeHtml(git.commit):'')+
    (p.name!=='stremio-dashboard'
     ?'<br><br><button onclick="restartApp(\\''+p.name+'\\')">🔄 Restart</button>'+
      '<button onclick="updateApp(\\''+p.name+'\\')">⬇️ Update</button>'
    :'')+
    '</div>';`, `   if(p.name==='stremio-sosac') git=d.git.main;
   if(p.name==='stremio-subtitles') git=d.git.subtitles;
   if(p.name==='stremio-dashboard') git=d.git.dashboard;
   if(p.name==='games-api') git=d.git.games;

   let gamesExtra='';
   if(p.name==='games-api'){
    const gh=d.gamesApi||{};
    gamesExtra='<br>Port: 8787'+
     '<br>API: <span class="'+(gh.online?'online':'offline')+'">'+(gh.online?'online':'offline')+'</span>'+
     (gh.providersTotal?'<br>Zdroje: '+gh.providersOk+' / '+gh.providersTotal:'')+
     '<br>Web: <a href="/games/" target="_blank" rel="noopener" style="color:#7dd3fc">/games/</a>';
   }

   return '<div class="card">'+
    '<div class="app">📦 '+escapeHtml(p.name)+'</div>'+
    '<div class="'+(p.status==='online'?'online':'offline')+'">● '+escapeHtml(p.status)+'</div>'+
    '<br>CPU: '+p.cpu+' %'+
    '<br>RAM: '+p.memory+' MB'+
    '<br>Uptime: '+fmtUptime(p.uptime)+
    '<br>Restarty: '+p.restarts+
    (git?'<br>Verze: '+escapeHtml(git.version)+
    '<br>Git: '+escapeHtml(git.branch)+' / '+escapeHtml(git.commit):'')+
    gamesExtra+
    (p.name!=='stremio-dashboard'
     ?'<br><br><button onclick="restartApp(\\''+p.name+'\\')">🔄 Restart</button>'+
      '<button onclick="updateApp(\\''+p.name+'\\')">⬇️ Update</button>'+
      (p.name==='games-api'?'<button class="secondary" onclick="auditGames()">🧪 Audit zdrojů</button>':'')
    :'')+
    '</div>';`);

replaceOnce('auditGames browser action', `function updateApp(name){
 action(
  'api/action/update/'+encodeURIComponent(name),
  'Git Pull + Restart '+name+'?'
 );
}

load();`, `function updateApp(name){
 action(
  'api/action/update/'+encodeURIComponent(name),
  name==='games-api' ? 'Aktualizovat GameS web + API z GitHubu?' : 'Git Pull + Restart '+name+'?'
 );
}

function auditGames(){
 action(
  'api/action/audit-games',
  'Otestovat oficiální Xbox, Steam, PlayStation, Nintendo a GeForce NOW endpointy? Test může trvat přibližně minutu.'
 );
}

load();`);

if (text === original) {
  console.log('Dashboard already contains the GameS integration.');
  process.exit(0);
}

const backup = `${file}.backup-games-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(file, backup);
fs.writeFileSync(file, text);
console.log(`Dashboard patched: ${file}`);
console.log(`Backup: ${backup}`);
