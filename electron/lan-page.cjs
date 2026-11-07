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
  .topbtn {
    position: absolute; top: calc(10px + env(safe-area-inset-top)); z-index: 12;
    min-width: 44px; min-height: 40px; padding: 0 14px; border: 0; border-radius: 20px;
    background: rgba(0,0,0,0.6); color: #fff; font-size: 14px;
    backdrop-filter: blur(4px);
  }
  #back { left: 10px; }
  #ccBtn { right: 62px; font-weight: 600; font-size: 12px; }
  #gear { right: 10px; font-size: 17px; }
  #cc {
    position: absolute; left: 50%; z-index: 11;
    transform: translateX(-50%); max-width: 92%;
    padding: 6px 14px; border-radius: 8px;
    text-align: center; pointer-events: none; white-space: pre-wrap;
  }
  #cc:empty { display: none; }
  #cc .zh { opacity: 0.85; margin-top: 2px; }

  /* Settings slide up from the bottom, where a thumb is. */
  #sheet {
    position: absolute; left: 0; right: 0; bottom: 0; z-index: 13;
    transform: translateY(102%); transition: transform 0.22s ease;
    background: #16161a; border-radius: 16px 16px 0 0;
    padding: 16px 18px calc(22px + env(safe-area-inset-bottom));
    box-shadow: 0 -8px 30px rgba(0,0,0,0.5);
  }
  #sheet.on { transform: translateY(0); }
  #sheet h3 { margin: 0 0 14px; font-size: 14px; font-weight: 600; }
  .row { margin-bottom: 15px; }
  .row label {
    display: flex; justify-content: space-between;
    font-size: 12px; color: rgba(255,255,255,0.5); margin-bottom: 7px;
  }
  /* Chunky enough to hit without aiming. */
  input[type=range] { width: 100%; height: 30px; accent-color: #3b82f6; }
  .seg { display: flex; gap: 6px; }
  .seg button {
    flex: 1; min-height: 38px; border: 0; border-radius: 8px;
    background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.75); font-size: 13px;
  }
  .seg button.on { background: #3b82f6; color: #fff; font-weight: 600; }
  .swatches { display: flex; gap: 8px; }
  .swatches button { flex: 1; height: 34px; border-radius: 8px; border: 2px solid transparent; }
  .swatches button.on { border-color: #3b82f6; }
  #sheetClose {
    width: 100%; min-height: 40px; margin-top: 4px; border: 0; border-radius: 8px;
    background: rgba(255,255,255,0.1); color: #fff; font-size: 14px;
  }
  #empty { padding: 40px 16px; text-align: center; color: rgba(255,255,255,0.4); }
</style>
</head>
<body>
<header><b>ReVid</b><span id="folder"></span></header>
<ul id="list"></ul>
<div id="empty" hidden>這個資料夾裡沒有影片。</div>

<div id="player">
  <button id="back" class="topbtn">← 返回</button>
  <button id="ccBtn" class="topbtn">中/EN</button>
  <button id="gear" class="topbtn">⚙</button>
  <video id="v" controls playsinline preload="metadata"></video>
  <div id="cc"></div>

  <div id="sheet">
    <h3>字幕設定</h3>
    <div class="row">
      <label><span>字體大小</span><span id="vSize"></span></label>
      <input id="size" type="range" min="12" max="34" step="1">
    </div>
    <div class="row">
      <label><span>垂直位置</span><span id="vPos"></span></label>
      <input id="pos" type="range" min="2" max="45" step="1">
    </div>
    <div class="row">
      <label><span>背景深淺</span><span id="vBg"></span></label>
      <input id="bg" type="range" min="0" max="100" step="5">
    </div>
    <div class="row">
      <label><span>外框</span><span id="vStroke"></span></label>
      <input id="stroke" type="range" min="0" max="6" step="0.5">
    </div>
    <div class="row">
      <label><span>文字顏色</span></label>
      <div class="swatches" id="colors"></div>
    </div>
    <button id="sheetClose">完成</button>
  </div>
</div>

<script>
const K = ${JSON.stringify(token)};
const q = (p, extra = {}) => p + '?k=' + encodeURIComponent(K) +
  Object.entries(extra).map(([a, b]) => '&' + a + '=' + encodeURIComponent(b)).join('');

const $ = (id) => document.getElementById(id);
const list = $('list'), player = $('player'), video = $('v'), cc = $('cc'), sheet = $('sheet');

const fmtSize = (n) => (n > 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : Math.round(n / 1048576) + ' MB');

// --- subtitle preferences, kept on the phone -----------------------------
const COLORS = ['#ffffff', '#ffe082', '#aed581', '#81d4fa'];
const CC_MODES = ['both', 'en', 'zh', 'off'];
const CC_LABEL = { both: '中/EN', en: 'EN', zh: '中', off: 'OFF' };
const DEFAULTS = { size: 17, pos: 14, bg: 65, stroke: 0, color: '#ffffff', mode: 'both' };

let prefs = { ...DEFAULTS };
try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('revid-mobile-subs') || '{}') }; } catch (e) {}
const savePrefs = () => { try { localStorage.setItem('revid-mobile-subs', JSON.stringify(prefs)); } catch (e) {} };

function applyPrefs() {
  cc.style.bottom = prefs.pos + '%';
  cc.style.background = 'rgba(0,0,0,' + (prefs.bg / 100) + ')';
  cc.style.fontSize = prefs.size + 'px';
  cc.style.color = prefs.color;
  if (prefs.stroke > 0) {
    // paint-order puts the stroke behind the glyph, so the requested width
    // is what you actually see instead of half of it.
    cc.style.webkitTextStroke = prefs.stroke + 'px #000';
    cc.style.paintOrder = 'stroke fill';
  } else {
    cc.style.webkitTextStroke = '';
  }
  cc.style.textShadow = '0 1px 3px rgba(0,0,0,0.85)';
  $('vSize').textContent = prefs.size + 'px';
  $('vPos').textContent = prefs.pos + '%';
  $('vBg').textContent = prefs.bg + '%';
  $('vStroke').textContent = prefs.stroke + 'px';
  $('ccBtn').textContent = CC_LABEL[prefs.mode];
  $('size').value = prefs.size; $('pos').value = prefs.pos;
  $('bg').value = prefs.bg; $('stroke').value = prefs.stroke;
  [...$('colors').children].forEach((b) => b.classList.toggle('on', b.dataset.c === prefs.color));
  render();
}

COLORS.forEach((c) => {
  const b = document.createElement('button');
  b.style.background = c; b.dataset.c = c;
  b.onclick = () => { prefs.color = c; savePrefs(); applyPrefs(); };
  $('colors').appendChild(b);
});
for (const [id, key] of [['size','size'], ['pos','pos'], ['bg','bg'], ['stroke','stroke']]) {
  $(id).oninput = (e) => { prefs[key] = Number(e.target.value); savePrefs(); applyPrefs(); };
}
$('gear').onclick = () => sheet.classList.add('on');
$('sheetClose').onclick = () => sheet.classList.remove('on');
$('ccBtn').onclick = () => {
  prefs.mode = CC_MODES[(CC_MODES.indexOf(prefs.mode) + 1) % CC_MODES.length];
  savePrefs(); applyPrefs();
};

// --- subtitles -----------------------------------------------------------
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

let cues = [], zhCues = [], shown = -1;

async function loadSubs(name, hasSubs, hasZh) {
  cues = []; zhCues = []; shown = -1; cc.innerHTML = '';
  if (hasSubs) {
    try { cues = parseSrt(await (await fetch(q('/api/subs', { name }))).text()); } catch (e) {}
  }
  if (hasZh) {
    try { zhCues = parseSrt(await (await fetch(q('/api/subs', { name, lang: 'zh' }))).text()); } catch (e) {}
  }
}

function render() {
  if (prefs.mode === 'off' || shown < 0) { cc.innerHTML = ''; return; }
  const en = cues[shown]?.text;
  const zh = zhCues[shown]?.text;
  const wantEn = prefs.mode === 'both' || prefs.mode === 'en';
  const wantZh = prefs.mode === 'both' || prefs.mode === 'zh';
  cc.innerHTML = '';
  if (wantEn && en) {
    const d = document.createElement('div');
    d.textContent = en;
    cc.appendChild(d);
  }
  if (wantZh && zh) {
    const d = document.createElement('div');
    d.className = 'zh';
    d.style.fontSize = Math.round(prefs.size * (wantEn && en ? 0.8 : 1)) + 'px';
    d.textContent = zh;
    cc.appendChild(d);
  }
}

video.addEventListener('timeupdate', () => {
  if (!cues.length) return;
  const t = video.currentTime;
  const i = cues.findIndex(c => t >= c.start && t <= c.end);
  if (i !== shown) { shown = i; render(); }
});

// --- library -------------------------------------------------------------
function open(file) {
  loadSubs(file.name, file.hasSubs, file.hasZh);
  video.src = q('/api/video', { name: file.name });
  player.classList.add('on');
  video.play().catch(() => {});
  history.pushState({ playing: true }, '');
}

function close() {
  video.pause();
  video.removeAttribute('src');
  video.load();
  player.classList.remove('on');
  sheet.classList.remove('on');
  cc.innerHTML = '';
}

$('back').onclick = () => history.back();
window.addEventListener('popstate', close);

fetch(q('/api/library')).then(r => r.json()).then(({ files, folder }) => {
  $('folder').textContent = folder || '';
  if (!files.length) { $('empty').hidden = false; return; }
  files.forEach((f, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<div class="idx"></div><div class="meta"><div class="name"></div><div class="sub"></div></div>';
    li.querySelector('.idx').textContent = i + 1;
    li.querySelector('.name').textContent = f.name;
    const sub = li.querySelector('.sub');
    sub.textContent = fmtSize(f.size);
    if (f.hasSubs) {
      const s = document.createElement('span');
      s.className = 'tag';
      s.textContent = f.hasZh ? '中/EN' : 'EN';
      sub.appendChild(s);
    }
    li.onclick = () => open(f);
    list.appendChild(li);
  });
}).catch(() => { $('empty').hidden = false; });

applyPrefs();
</script>
</body>
</html>`;
