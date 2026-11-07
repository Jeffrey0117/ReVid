// The page phones get. Self-contained on purpose: no build step, no assets
// to serve, and nothing to keep in sync with the desktop renderer.
exports.render = (token) => `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<title>ReVid</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0; background: #0a0a0a; color: #fff;
    font: 15px/1.5 -apple-system, "Noto Sans TC", "Segoe UI", system-ui, sans-serif;
    padding-bottom: env(safe-area-inset-bottom);
  }
  header {
    position: sticky; top: 0; z-index: 5;
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px; background: #121214;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  header b { font-size: 15px; }
  header span { font-size: 12px; color: rgba(255,255,255,0.45); }
  ul { list-style: none; margin: 0; padding: 8px 0; }
  li {
    display: flex; align-items: center; gap: 12px;
    padding: 13px 16px; border-bottom: 1px solid rgba(255,255,255,0.06);
    cursor: pointer;
  }
  li:active { background: rgba(255,255,255,0.06); }
  .idx {
    flex: none; min-width: 26px; height: 26px; border-radius: 6px;
    display: grid; place-items: center;
    background: rgba(255,255,255,0.08); font-size: 12px;
    color: rgba(255,255,255,0.6);
  }
  .meta { min-width: 0; flex: 1; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 2px; }
  .tag {
    display: inline-block; margin-left: 6px; padding: 0 5px; border-radius: 3px;
    background: rgba(59,130,246,0.22); color: #93c5fd; font-size: 10px;
  }
  /* Player takes the whole screen: a phone has none to spare. */
  #player { position: fixed; inset: 0; z-index: 10; background: #000; display: none; }
  #player.on { display: block; }
  video { width: 100%; height: 100%; background: #000; }
  #back {
    position: absolute; top: calc(10px + env(safe-area-inset-top)); left: 10px; z-index: 12;
    padding: 9px 15px; border: 0; border-radius: 20px;
    background: rgba(0,0,0,0.6); color: #fff; font-size: 14px;
    backdrop-filter: blur(4px);
  }
  #cc {
    position: absolute; left: 50%; bottom: 14%; z-index: 11;
    transform: translateX(-50%); max-width: 90%;
    padding: 7px 14px; border-radius: 8px;
    background: rgba(0,0,0,0.65); text-align: center;
    pointer-events: none; white-space: pre-wrap;
  }
  #cc:empty { display: none; }
  #cc .en { font-size: 17px; line-height: 1.35; }
  #cc .zh { font-size: 13px; line-height: 1.35; color: rgba(255,255,255,0.8); margin-top: 2px; }
  #empty { padding: 40px 16px; text-align: center; color: rgba(255,255,255,0.4); }
</style>
</head>
<body>
<header><b>ReVid</b><span id="folder"></span></header>
<ul id="list"></ul>
<div id="empty" hidden>這個資料夾裡沒有影片。</div>

<div id="player">
  <button id="back">← 返回</button>
  <video id="v" controls playsinline preload="metadata"></video>
  <div id="cc"></div>
</div>

<script>
const K = ${JSON.stringify(token)};
const q = (p, extra = {}) => p + '?k=' + encodeURIComponent(K) +
  Object.entries(extra).map(([a, b]) => '&' + a + '=' + encodeURIComponent(b)).join('');

const list = document.getElementById('list');
const player = document.getElementById('player');
const video = document.getElementById('v');
const cc = document.getElementById('cc');

const fmtSize = (n) => (n > 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : Math.round(n / 1048576) + ' MB');

// Minimal SRT parse — the desktop writes these, so the shape is known.
function parseSrt(text) {
  const out = [];
  for (const block of text.replace(/\\r/g, '').split(/\\n{2,}/)) {
    const lines = block.split('\\n').filter(Boolean);
    const i = lines.findIndex(l => l.includes('-->'));
    if (i === -1) continue;
    const m = lines[i].match(/(\\d+):(\\d+):(\\d+)[,.](\\d+)\\s*-->\\s*(\\d+):(\\d+):(\\d+)[,.](\\d+)/);
    if (!m) continue;
    const t = (h, mi, s, ms) => +h * 3600 + +mi * 60 + +s + +ms / 1000;
    const body = lines.slice(i + 1).join('\\n').trim();
    if (body) out.push({ start: t(m[1],m[2],m[3],m[4]), end: t(m[5],m[6],m[7],m[8]), text: body });
  }
  return out;
}

let cues = [];
let zhCues = [];

async function loadSubs(name, hasSubs, hasZh) {
  cues = []; zhCues = []; cc.innerHTML = '';
  if (hasSubs) {
    try { cues = parseSrt(await (await fetch(q('/api/subs', { name }))).text()); } catch (e) {}
  }
  if (hasZh) {
    try { zhCues = parseSrt(await (await fetch(q('/api/subs', { name, lang: 'zh' })))?.text()); } catch (e) {}
  }
}

video.addEventListener('timeupdate', () => {
  if (!cues.length) return;
  const t = video.currentTime;
  const i = cues.findIndex(c => t >= c.start && t <= c.end);
  if (i < 0) { cc.innerHTML = ''; return; }
  const zh = zhCues[i]?.text;
  cc.innerHTML = '<div class="en"></div>' + (zh ? '<div class="zh"></div>' : '');
  cc.firstChild.textContent = cues[i].text;
  if (zh) cc.lastChild.textContent = zh;
});

function open(file) {
  loadSubs(file.name, file.hasSubs, file.hasZh);
  video.src = q('/api/video', { name: file.name });
  player.classList.add('on');
  video.play().catch(() => {});
  // Back button leaves the player instead of the site.
  history.pushState({ playing: true }, '');
}

function close() {
  video.pause();
  video.removeAttribute('src');
  video.load();
  player.classList.remove('on');
  cc.innerHTML = '';
}

document.getElementById('back').onclick = () => history.back();
window.addEventListener('popstate', close);

fetch(q('/api/library')).then(r => r.json()).then(({ files, folder }) => {
  document.getElementById('folder').textContent = folder || '';
  if (!files.length) { document.getElementById('empty').hidden = false; return; }
  files.forEach((f, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<div class="idx"></div><div class="meta"><div class="name"></div><div class="sub"></div></div>';
    li.querySelector('.idx').textContent = i + 1;
    li.querySelector('.name').textContent = f.name;
    const sub = li.querySelector('.sub');
    sub.textContent = fmtSize(f.size);
    if (f.hasSubs) { const s = document.createElement('span'); s.className = 'tag'; s.textContent = f.hasZh ? '中/EN' : 'EN'; sub.appendChild(s); }
    li.onclick = () => open(f);
    list.appendChild(li);
  });
}).catch(() => { document.getElementById('empty').hidden = false; });
</script>
</body>
</html>`;
