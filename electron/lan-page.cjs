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
  if (below >= 92) {
    placement = { mode: 'below', allowance: Math.round(below) - 12 };
    cc.classList.add('below');
    cc.style.top = Math.round(box.bottom + 8) + 'px';
    cc.style.bottom = 'auto';
  } else {
    placement = { mode: 'over', allowance: Math.round(box.height * 0.34) };
    cc.classList.remove('below');
    cc.style.top = 'auto';
    cc.style.bottom = prefs.pos + '%';
  }
  cc.style.maxHeight = placement.allowance + 'px';
  renderCue();
}

// The size slider is a wish, not an instruction: turning it up used to make
// the block taller until it covered the picture. This finds the largest
// size up to what was asked for whose text actually fits the allowance.
// Subtitles are read in glances, so never more than two lines each.
//
// Whisper emits one cue per utterance, and an utterance runs to ninety
// characters — as a single subtitle that is four lines of English stacked
// on four of Chinese, covering the picture. Shrinking the type does not
// fix it: the cue has to be shown in pieces, each for its share of the
// cue's time, which is what every real subtitle renderer does.
const MAX_LINES = 2;
const BREAK_AFTER = /[.!?。！？]/;
const SOFT_AFTER = /[,;:，；：、]/;

function perLineChars(widthPx, fontSize, cjk) {
  return Math.max(6, Math.floor(widthPx / (fontSize * (cjk ? 1.0 : 0.56))));
}

function chunkText(text, maxChars) {
  // Double backslash: this file is one big template literal, so a single
  // one is eaten before the page is written and /\s+/ ships as /s+/ — a
  // pattern that deletes every letter s. "best life sentence" arrived on
  // the phone as "be t life entence".
  const clean = (text || '').replace(/\\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks = [];
  let rest = clean;
  while (rest.length > maxChars) {
    // Exactly maxChars: a break at the last index gives a cut of maxChars,
    // never one past it, which would be an extra line.
    const win = rest.slice(0, maxChars);
    const floor = Math.floor(maxChars * 0.4);
    let cut = -1;
    for (let i = win.length - 1; i >= floor; i--) {
      if (BREAK_AFTER.test(win[i])) { cut = i + 1; break; }
    }
    if (cut < 0) {
      for (let i = win.length - 1; i >= floor; i--) {
        if (SOFT_AFTER.test(win[i])) { cut = i + 1; break; }
      }
    }
    if (cut < 0) {
      const gap = win.lastIndexOf(' ');
      if (gap >= floor) cut = gap;
    }
    if (cut < 0) cut = maxChars;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

// Both languages are the same sentence, so they advance together; the one
// with more pieces sets the pace rather than one of them going blank.
function visibleCue(en, zh, progress, size) {
  // Must match the CSS: 94% of the viewport, less the box's own padding.
  // Overstating it by even a little makes every piece wrap one line deeper
  // than the chunker intended.
  const width = Math.max(120, Math.min(window.innerWidth * 0.94, 900) - 20);
  const enChunks = chunkText(en, perLineChars(width, size, false) * MAX_LINES);
  const zhChunks = chunkText(zh, perLineChars(width, Math.round(size * 0.8), true) * MAX_LINES);
  // Whichever needs more pieces sets the pace; the other is stretched across
  // those beats, repeating a line rather than having its tail never reached.
  // Re-splitting it to match looked tidier and silently dropped the end of
  // the sentence.
  const steps = Math.max(enChunks.length, zhChunks.length, 1);
  const step = Math.floor(Math.max(0, Math.min(0.999, progress)) * steps);
  const pick = (l) => (l.length ? l[Math.min(l.length - 1, Math.floor(step * l.length / steps))] : '');
  return { en: pick(enChunks), zh: pick(zhChunks) };
}

function applyPrefs() {
  // The vertical slider only means anything while overlaying; below the
  // picture the subtitle is pinned under it and this would fight fitStage.
  if (placement.mode === 'over') cc.style.bottom = prefs.pos + '%';
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
    try { cues = parseSrt(await (await fetch(q('/api/subs', { name }))).text()); } catch (e) {}
  }
  if (hasZh) {
    try { zhCues = parseSrt(await (await fetch(q('/api/subs', { name, lang: 'zh' }))).text()); } catch (e) {}
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
  const piece = visibleCue(wantEn ? en : '', wantZh ? zh : '', progress, size);

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
