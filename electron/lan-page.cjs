const fs = require('fs');
const path = require('path');

// subtitle-overlay-kit, inlined into the page.
//
// This page used to carry its own copy of the chunking logic, and that copy
// drifted: the phone split long cues into readable pieces while the desktop
// player rendered them whole, for weeks, because nobody remembered there were
// two. Now there is one source and the page gets it verbatim — the phone has
// no module loader and this page is deliberately a single self-contained
// document, so the text is injected rather than served as a second file.
const KIT_SOURCE = (() => {
    const file = path.join(__dirname, 'vendor', 'subtitle-overlay-kit.cjs');
    const src = fs.readFileSync(file, 'utf8');
    const cut = src.indexOf('module.exports = {');
    if (cut < 0) throw new Error('vendored kit has no export block — did it change shape?');
    // The epilogue is CommonJS; everything above it is plain declarations a
    // browser can run as-is.
    return src.slice(0, cut).replace(/^'use strict';\s*$/m, '');
})();

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
  #player.on { display: flex; align-items: center; justify-content: center; }
  /* The stage is the picture, not the screen. A landscape video on a
     portrait phone leaves most of the screen black, and subtitles anchored
     to the screen ended up floating in that black, metres from the video. */
  #stage { position: relative; width: 100%; max-height: 100%; }
  video { display: block; width: 100%; height: 100%; background: #000; }
  .topbtn {
    position: absolute; top: calc(10px + env(safe-area-inset-top)); z-index: 12;
    min-width: 44px; min-height: 40px; padding: 0 14px; border: 0; border-radius: 20px;
    background: rgba(0,0,0,0.6); color: #fff; font-size: 14px;
    backdrop-filter: blur(4px);
  }
  #back { left: 10px; }
  #ccBtn { right: 62px; font-weight: 600; font-size: 12px; }
  /* A drawn icon, not an emoji: emoji render as whatever glyph the phone
     happens to ship and sit off the optical centre of the button. */
  #gear { right: 10px; display: inline-flex; align-items: center; justify-content: center; }
  #gear svg { width: 19px; height: 19px; }
  /* Two homes for the subtitle. Over the picture when the video fills the
     screen, and in the black below it when it does not — which on a
     portrait phone is most of the screen, sitting empty while the text
     covered the only part worth looking at. */
  /* Spanning both edges, not anchored at the centre. Centring with
     left:50% leaves a shrink-to-fit box only half the viewport to lay text
     in, so every line wrapped at half the width available and the block
     stacked to twice the height. The narrowness caused the height. */
  #cc {
    position: absolute; left: 0; right: 0; z-index: 11;
    width: fit-content; max-width: 94%; margin-inline: auto;
    padding: 5px 10px; border-radius: 8px;
    text-align: center; pointer-events: none; white-space: pre-wrap;
    line-height: 1.25; text-wrap: balance;
    /* Never hidden: if a line does overflow its allowance, letting it
       spill is honest, where clipping silently eats words. */
    overflow: visible;
  }
  #cc.below {
    position: fixed; bottom: auto;
    max-width: 96%;
  }
  #cc:empty { display: none; }
  #cc .zh { opacity: 0.85; margin-top: 2px; }

  /* Settings slide up from the bottom, where a thumb is. */
  /* Pinned to the top and kept small, because every control in it changes
     how the subtitle looks — and the subtitle is at the bottom. A sheet
     that filled the screen meant adjusting blind and checking afterwards. */
  #sheet {
    position: fixed; left: 8px; right: 8px; z-index: 13;
    /* Below the top buttons, so back and the subtitle-mode toggle stay
       reachable while the panel is open. */
    top: calc(58px + env(safe-area-inset-top));
    /* A card, not a sheet. Every control in it changes the subtitle, so it
       has to leave the subtitle on screen — and it is reached often enough
       that it should get out of the way fast. */
    width: 248px; margin-left: auto; margin-right: 8px;
    max-height: 62vh; overflow-y: auto;
    transform: translateY(-120%); transition: transform 0.2s ease;
    background: rgba(18,18,22,0.94); backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
    padding: 8px 11px 10px;
    box-shadow: 0 10px 34px rgba(0,0,0,0.55);
  }
  #sheet.on { transform: translateY(0); }
  #sheet h3 { margin: 0 0 6px; font-size: 12px; font-weight: 600; }
  .row { margin-bottom: 4px; }
  .row label {
    display: flex; justify-content: space-between;
    font-size: 10.5px; color: rgba(255,255,255,0.45); margin-bottom: 0;
  }
  /* Still a 20px target, with the slack trimmed off the sides. */
  input[type=range] { width: 100%; height: 20px; margin: 0; accent-color: #3b82f6; }
  .seg { display: flex; gap: 6px; }
  .seg button {
    flex: 1; min-height: 38px; border: 0; border-radius: 8px;
    background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.75); font-size: 13px;
  }
  .seg button.on { background: #3b82f6; color: #fff; font-weight: 600; }
  .swatches { display: flex; gap: 6px; }
  .swatches button { flex: 1; height: 26px; border-radius: 6px; border: 2px solid transparent; }
  .swatches button.on { border-color: #3b82f6; }
  #sheetClose {
    width: 100%; min-height: 32px; margin-top: 6px; border: 0; border-radius: 7px;
    background: rgba(255,255,255,0.1); color: #fff; font-size: 13px;
  }
  #empty { padding: 40px 16px; text-align: center; color: rgba(255,255,255,0.4); }
  /* Scrolls sideways rather than wrapping: eight seasons on a phone would
     otherwise push the episode list off the first screen. */
  #seasons {
    display: flex; gap: 6px; padding: 8px 12px;
    overflow-x: auto; -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  #seasons::-webkit-scrollbar { display: none; }
  #seasons button {
    flex: 0 0 auto; min-height: 34px; padding: 0 14px;
    border: 0; border-radius: 17px; font-size: 13px;
    background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.75);
  }
  #seasons button.on { background: #3b82f6; color: #fff; }
</style>
</head>
<body>
<header><b>ReVid</b><span id="folder"></span></header>
<nav id="seasons" hidden></nav>
<ul id="list"></ul>
<div id="empty" hidden>這個資料夾裡沒有影片。</div>

<div id="player">
  <button id="back" class="topbtn">← 返回</button>
  <button id="ccBtn" class="topbtn">中/EN</button>
  <button id="gear" class="topbtn" aria-label="字幕設定">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2"/>
      <path d="M7 15h4M15 15h2M7 11h2M13 11h4"/>
    </svg>
  </button>
  <div id="stage">
    <video id="v" controls playsinline preload="metadata"></video>
    <div id="cc"></div>
  </div>

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

// Which season is on screen. Every file request carries it, because the
// same episode number exists in every season.
let currentFolder = '';

const $ = (id) => document.getElementById(id);
const list = $('list'), player = $('player'), video = $('v'), cc = $('cc'), sheet = $('sheet');

const fmtSize = (n) => (n > 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : Math.round(n / 1048576) + ' MB');

// --- subtitle preferences, kept on the phone -----------------------------
const COLORS = ['#ffffff', '#ffe082', '#aed581', '#81d4fa'];
const CC_MODES = ['both', 'en', 'zh', 'off'];
const CC_LABEL = { both: '中/EN', en: 'EN', zh: '中', off: 'OFF' };
// Sized against the screen, not a fixed pixel count: 17px is comfortable on
// a tablet and enormous on a 390px phone, where it wrapped a line of dialogue
// into eight rows over the picture.
const fitSize = () => Math.round(Math.max(13, Math.min(26, window.innerWidth * 0.042)));
const DEFAULTS = { size: fitSize(), pos: 8, bg: 65, stroke: 0, color: '#ffffff', mode: 'both' };

let prefs = { ...DEFAULTS };
try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('revid-mobile-subs') || '{}') }; } catch (e) {}
const savePrefs = () => { try { localStorage.setItem('revid-mobile-subs', JSON.stringify(prefs)); } catch (e) {} };

// The stage matches the picture's shape, so the subtitle can be placed
// against the video rather than against the screen.
let placement = { mode: 'over', allowance: 200 };

function fitStage() {
  const stage = document.getElementById('stage');
  const v = document.getElementById('v');
  if (!stage || !v || !v.videoWidth || !v.videoHeight) return;
  stage.style.aspectRatio = v.videoWidth + ' / ' + v.videoHeight;
  // Tall videos are bounded by height instead, letterboxing left and right.
  const screenRatio = window.innerWidth / window.innerHeight;
  const videoRatio = v.videoWidth / v.videoHeight;
  stage.style.width = videoRatio >= screenRatio ? '100%' : 'auto';
  stage.style.height = videoRatio >= screenRatio ? 'auto' : '100%';

  const box = stage.getBoundingClientRect();
  const below = Math.max(0, (window.innerHeight - box.height) / 2);
  // Under the picture when there is real room down there — on a portrait
  // phone that is most of the screen, and it was sitting empty while the
  // text covered the only part worth looking at.
  placement = {
    mode: below >= 92 ? 'below' : 'over',
    allowance: below >= 92 ? Math.round(below) - 12 : Math.round(box.height * 0.34),
    videoBottom: box.bottom,
    videoHeight: box.height
  };

  cc.style.maxHeight = placement.allowance + 'px';
  placeCc();
  renderCue();
}

// One continuous sweep rather than two modes. At 0 the subtitle sits over
// the lower part of the picture, the way a subtitle normally does; turning
// it up slides it down, out of the picture and into whatever black is
// below. Splitting this into an overlay case and a below-the-video case
// meant the slider only reached one of them.
const POS_MAX = 45;

function placeCc() {
  cc.classList.add('below'); // fixed positioning; the width cap comes with it
  cc.style.bottom = 'auto';

  const h = cc.offsetHeight || 40;
  const bottom = placement.videoBottom || window.innerHeight;
  const videoH = placement.videoHeight || window.innerHeight;

  // Highest: inside the picture, clear of its very bottom edge.
  const highest = bottom - h - videoH * 0.06;
  // Lowest: resting on the bottom of the screen.
  const lowest = window.innerHeight - h - 8;

  const t = Math.min(1, Math.max(0, prefs.pos / POS_MAX));
  cc.style.top = Math.round(highest + t * Math.max(0, lowest - highest)) + 'px';
}

// ---- subtitle-overlay-kit (inlined verbatim; edit upstream, not here) ----
${KIT_SOURCE}
// ---- end subtitle-overlay-kit ----


// The kit does the splitting; this only tells it how wide the box is.
function cuePiece(en, zh, progress, size) {
  // Must match the CSS: 94% of the viewport, less the box's own padding.
  // Overstating it by even a little makes every piece wrap one line deeper
  // than the chunker intended.
  const width = Math.max(120, Math.min(window.innerWidth * 0.94, 900) - 20);
  return visibleCue({ en: en, zh: zh, progress: progress, widthPx: width, fontSize: size });
}

function applyPrefs() {
  placeCc();
  cc.style.background = 'rgba(0,0,0,' + (prefs.bg / 100) + ')';
  // Size is not set here: render() works out what fits this cue, and a
  // value written here would just be overwritten a moment later.
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
    try { cues = parseSrt(await (await fetch(q('/api/subs', { name, folder: currentFolder }))).text()); } catch (e) {}
  }
  if (hasZh) {
    try { zhCues = parseSrt(await (await fetch(q('/api/subs', { name, folder: currentFolder, lang: 'zh' }))).text()); } catch (e) {}
  }
}

let lastDrawn = '';

function render() {
  if (prefs.mode === 'off' || shown < 0) {
    if (lastDrawn !== '') { cc.innerHTML = ''; lastDrawn = ''; }
    return;
  }
  const en = cues[shown]?.text;
  const zh = zhCues[shown]?.text;
  const wantEn = prefs.mode === 'both' || prefs.mode === 'en';
  const wantZh = prefs.mode === 'both' || prefs.mode === 'zh';

  // How far through this cue we are, so a long one is shown in pieces
  // rather than all at once.
  const cue = cues[shown];
  const span = Math.max(0.3, (cue?.end ?? 0) - (cue?.start ?? 0));
  const progress = (video.currentTime - (cue?.start ?? 0)) / span;

  const size = prefs.size;
  const piece = cuePiece(wantEn ? en : '', wantZh ? zh : '', progress, size);

  // Redrawing identical text four times a second would flicker.
  const key = size + '|' + piece.en + '|' + piece.zh;
  if (key === lastDrawn) return;
  lastDrawn = key;

  cc.style.fontSize = size + 'px';
  cc.innerHTML = '';
  if (piece.en) {
    const d = document.createElement('div');
    d.textContent = piece.en;
    cc.appendChild(d);
  }
  if (piece.zh) {
    const d = document.createElement('div');
    d.className = 'zh';
    d.style.fontSize = Math.round(size * (piece.en ? 0.8 : 1)) + 'px';
    d.textContent = piece.zh;
    cc.appendChild(d);
  }
}

// fitStage runs before the first cue exists, so it needs a safe name to call.
function renderCue() { try { render(); } catch (e) {} }

video.addEventListener('loadedmetadata', fitStage);
window.addEventListener('resize', fitStage);
window.addEventListener('orientationchange', () => setTimeout(fitStage, 200));

video.addEventListener('timeupdate', () => {
  if (!cues.length) return;
  const t = video.currentTime;
  const i = cues.findIndex(c => t >= c.start && t <= c.end);
  // Also within a cue: a long one is shown in pieces, so the text changes
  // while the index does not. render() only touches the DOM when what it
  // would draw differs, so running it four times a second does not flicker.
  if (i !== shown) shown = i;
  render();
});

// --- library -------------------------------------------------------------
function open(file) {
  loadSubs(file.name, file.hasSubs, file.hasZh);
  video.src = q('/api/video', { name: file.name, folder: currentFolder });
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

// Seasons sit beside each other under the shared root, so switching is a
// reload of the list rather than anything on the serving side.
function renderSeasons(folders, current) {
  const nav = $('seasons');
  nav.innerHTML = '';
  if (folders.length < 2) { nav.hidden = true; return; }
  nav.hidden = false;
  folders.forEach((name) => {
    const b = document.createElement('button');
    b.textContent = name;
    if (name === current) b.className = 'on';
    b.onclick = () => { if (name !== currentFolder) loadLibrary(name); };
    nav.appendChild(b);
  });
}

function loadLibrary(folder) {
  list.innerHTML = '';
  $('empty').hidden = true;
  return fetch(q('/api/library', folder ? { folder } : {}))
    .then(r => r.json())
    .then(({ files, folders, folder: at, root }) => {
      currentFolder = at || '';
      $('folder').textContent = currentFolder || root || '';
      renderSeasons(folders || [], currentFolder);
      // Landing on the show folder itself, which holds no videos of its own:
      // show the first season rather than an empty list and no explanation.
      if (!files.length && !currentFolder && (folders || []).length) {
        return loadLibrary(folders[0]);
      }
      if (!files.length) { $('empty').hidden = false; return undefined; }
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
      return undefined;
    })
    .catch(() => { $('empty').hidden = false; });
}

loadLibrary('');

applyPrefs();
</script>
</body>
</html>`;
