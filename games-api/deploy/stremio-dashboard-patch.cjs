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

replaceOnce('APPS stremio-sosac links', `  'stremio-sosac': {
    repo: '/home/ubuntu/stremio.sosac'
  },`, `  'stremio-sosac': {
    repo: '/home/ubuntu/stremio.sosac',
    github: 'https://github.com/CaseyCZ/stremio.sosac',
    web: 'https://130.61.49.108:8443/stremio-sosac/manifest.json'
  },`);

replaceOnce('APPS stremio-subtitles links', `  'stremio-subtitles': {
    repo: '/home/ubuntu/stremio.sosac.subtitles'
  },`, `  'stremio-subtitles': {
    repo: '/home/ubuntu/stremio.sosac.subtitles',
    github: 'https://github.com/CaseyCZ/stremio.sosac.subtitles',
    web: 'https://130.61.49.108:8443/stremio-sosac-subtitles/manifest.json'
  },`);

replaceOnce('APPS stremio-dashboard links', `  'stremio-dashboard': {
    repo: '/home/ubuntu/stremio-dashboard'
  },`, `  'stremio-dashboard': {
    repo: '/home/ubuntu/stremio-dashboard',
    github: 'https://github.com/CaseyCZ/stremio-dashboard',
    web: 'https://130.61.49.108:8443/dashboard/'
  },`);

replaceOnce('APPS games-api links', `  'games-api': {
    repo: '/home/ubuntu/games-calendar/repo/games-api'
  }
};`, `  'games-api': {
    repo: '/home/ubuntu/games-calendar/repo/games-api',
    github: 'https://github.com/CaseyCZ/GameS-Calendar-Website',
    web: 'https://130.61.49.108:8443/games/'
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

replaceOnce('status app links metadata', `    gamesApi: gamesHealth,
    cert,`, `    gamesApi: gamesHealth,
    apps: Object.fromEntries(Object.entries(APPS).map(([name, app]) => [name, {
      github: app.github || null,
      web: app.web || null
    }])),
    cert,`);

replaceOnce('GameS special update', `  if (!APPS[name] || name === 'stremio-dashboard') {
    return res.status(404).json({ ok:false });
  }

  const repo = APPS[name].repo;`, `  if (!APPS[name] || name === 'stremio-dashboard') {
    return res.status(404).json({ ok:false });
  }

  if (name === 'games-api') {
    const deploy = await run(
      '/usr/bin/bash',
      ['/home/ubuntu/games-calendar/repo/games-api/deploy/stremio-server-update.sh'],
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

replaceOnce('GameS audit control button', `<button class="danger" onclick="action('/api/action/reboot','RESTARTOVAT CELÝ SERVER?')">⚠️ Reboot serveru</button>`, `<button class="danger" onclick="action('/api/action/reboot','RESTARTOVAT CELÝ SERVER?')">⚠️ Reboot serveru</button>
<button class="secondary" onclick="auditGames()">🧪 GameS audit zdrojů</button>`);

replaceOnce('GameS logs button', `<button onclick="logs('stremio-dashboard')">Dashboard</button>`, `<button onclick="logs('stremio-dashboard')">Dashboard</button>
<button onclick="logs('games-api')">GameS API</button>`);

replaceOnce('GameS card mapping', `  if(p.name==='stremio-dashboard') git=d.git.dashboard;`, `  if(p.name==='stremio-dashboard') git=d.git.dashboard;
  if(p.name==='games-api') git=d.git.games;

  let gamesExtra='';
  if(p.name==='games-api'){
   const gh=d.gamesApi||{};
   gamesExtra='<br>Port: 8787'+
    '<br>API: <span class="'+(gh.online?'online':'offline')+'">'+(gh.online?'online':'offline')+'</span>'+
    (gh.providersTotal?'<br>Zdroje: '+gh.providersOk+' / '+gh.providersTotal:'')+
    '<br>Web: <a href="/games/" target="_blank" rel="noopener" style="color:#7dd3fc">/games/</a>';
  }`);

replaceOnce('dashboard card app links', `  let gamesExtra='';
  if(p.name==='games-api'){
   const gh=d.gamesApi||{};
   gamesExtra='<br>Port: 8787'+
    '<br>API: <span class="'+(gh.online?'online':'offline')+'">'+(gh.online?'online':'offline')+'</span>'+
    (gh.providersTotal?'<br>Zdroje: '+gh.providersOk+' / '+gh.providersTotal:'')+
    '<br>Web: <a href="/games/" target="_blank" rel="noopener" style="color:#7dd3fc">/games/</a>';
  }`, `  let gamesExtra='';
  if(p.name==='games-api'){
   const gh=d.gamesApi||{};
   gamesExtra='<br>Port: 8787'+
    '<br>API: <span class="'+(gh.online?'online':'offline')+'">'+(gh.online?'online':'offline')+'</span>'+
    (gh.providersTotal?'<br>Zdroje: '+gh.providersOk+' / '+gh.providersTotal:'');
  }

  const appMeta=(d.apps&&d.apps[p.name])||{};
  const appLinks=[];
  if(appMeta.github) appLinks.push('<a href="'+escapeHtml(appMeta.github)+'" target="_blank" rel="noopener noreferrer">GitHub</a>');
  if(appMeta.web) appLinks.push('<a href="'+escapeHtml(appMeta.web)+'" target="_blank" rel="noopener noreferrer">Live</a>');
  const linksExtra=appLinks.length
   ? '<br><span class="app-links" style="display:inline-flex;gap:10px;margin-top:8px">'+appLinks.join(' · ')+'</span>'
   : '';`);

replaceOnce('GameS card extra fields', `   (git?'<br>Verze: '+escapeHtml(git.version)+
   '<br>Git: '+escapeHtml(git.branch)+' / '+escapeHtml(git.commit):'')+
   (p.name!=='stremio-dashboard'`, `   (git?'<br>Verze: '+escapeHtml(git.version)+
   '<br>Git: '+escapeHtml(git.branch)+' / '+escapeHtml(git.commit):'')+
   gamesExtra+
   (p.name!=='stremio-dashboard'`);

replaceOnce('card app links output', `   gamesExtra+
   (p.name!=='stremio-dashboard'`, `   gamesExtra+
   linksExtra+
   (p.name!=='stremio-dashboard'`);

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
  console.log('Dashboard already contains the GameS integration and app links.');
  process.exit(0);
}

const backup = `${file}.backup-games-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(file, backup);
fs.writeFileSync(file, text);
console.log(`Dashboard patched: ${file}`);
console.log(`Backup: ${backup}`);
