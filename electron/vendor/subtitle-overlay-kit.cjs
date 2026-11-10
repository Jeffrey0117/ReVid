// VENDORED from subtitle-overlay-kit — do not edit here.
//
//   upstream: https://github.com/Jeffrey0117/subtitle-overlay-kit
//   commit:   1cf60d14ddf52d9cfa76871c686e4aa0b912a30b
//
// Byte-identical to the kit below this header. Fix bugs upstream and
// re-vendor: a fix made here is a fix the userscript and the extension
// never get, which is the whole thing the kit exists to prevent.
// Lives under electron/ because that is what ships — src/ is not packaged.

'use strict';

/*
 * subtitle-overlay-kit — 字幕「怎麼顯示在影片上」的純邏輯（vanilla JS，零依賴）
 * ---------------------------------------------------------------------------
 * 這顆 kit 不解析字幕、不翻譯、不碰播放器，也不畫任何 DOM。它只回答兩個問題：
 *
 *   1. 這一刻該顯示哪段文字？（長 cue 切成讀得完的片段）
 *   2. 那個框該放在哪、多大？（錨邊 + 位移 + 寬度 + 等比縮放）
 *
 * 之所以是同一顆 kit：這兩件事互相咬合——「一行放得下幾個字」要先知道框多寬，
 * 而框多寬是幾何的事。拆成兩顆會逼呼叫端自己把寬度在兩邊傳來傳去。
 *
 * 【組合縫】
 *   - bilingual-subtitle-kit：負責 parse / 翻譯 / 找出當下的 cue；本 kit 接手它
 *     吐出來的 { start, end, text, zh } 決定「顯示什麼、放哪裡」。
 *   - video-core-kit：負責把串流接上 <video> 並發進度事件；本 kit 只吃一個
 *     0..1 的 progress 數字，不認識播放器。
 *
 * 【為什麼需要切片】
 *   Whisper 之類的轉錄會把一整段對話吐成單一 cue——六個句子、兩百個字。整段畫
 *   上去就是畫面中央一片七行的告示牌。縮小字級救不了（那只是變成小字的告示
 *   牌），必須把 cue 切開，每片各佔這個 cue 自己時間的一份。
 */

/* ------------------------------------------------------------------ *
 * 一、顯示什麼：把過長的 cue 切成讀得完的片段
 * ------------------------------------------------------------------ */

var DEFAULT_MAX_LINES = 2;

// 斷句優先序：句號 > 逗號 > 詞間空白 > 隨便斷（中文沒有前三種）
var BREAK_AFTER = /[.!?。！？]/;
var SOFT_AFTER = /[,;:，；：、]/;

// 一行放得下幾個字。CJK 字身約為拉丁的兩倍寬，所以混排以較寬的那半計。
// latinRatio 可注入：不同字體的平均字寬差很多，寫死 0.56 只對無襯線體準。
function charsPerLine(widthPx, fontSize, cjk, latinRatio) {
  var ratio = cjk ? 1.0 : (typeof latinRatio === 'number' ? latinRatio : 0.56);
  var per = fontSize * ratio;
  if (!(per > 0) || !(widthPx > 0)) return 6;
  return Math.max(6, Math.floor(widthPx / per));
}

// 切成每片都塞得進 maxChars 的片段，斷在人會斷的地方。
function chunkText(text, maxChars) {
  var clean = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (!(maxChars > 0)) return [clean];
  if (clean.length <= maxChars) return [clean];

  var chunks = [];
  var rest = clean;

  while (rest.length > maxChars) {
    // 剛好 maxChars：在最後一個索引斷，切出來就是 maxChars，不會多一個。
    // 曾經多找一格，把 42 字的上限變成 43、把兩行擠成三行。
    var window_ = rest.slice(0, maxChars);
    var floor = Math.floor(maxChars * 0.4);
    var cut = -1;
    var i;

    for (i = window_.length - 1; i >= floor; i--) {
      if (BREAK_AFTER.test(window_[i])) { cut = i + 1; break; }
    }
    if (cut < 0) {
      for (i = window_.length - 1; i >= floor; i--) {
        if (SOFT_AFTER.test(window_[i])) { cut = i + 1; break; }
      }
    }
    if (cut < 0) {
      var gap = window_.lastIndexOf(' ');
      if (gap >= floor) cut = gap;
    }
    if (cut < 0) cut = maxChars;

    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

// 走到第幾片。平均分配，而不是按長度加權——加權會讓短片段一閃而過來不及讀。
function chunkAt(chunks, progress) {
  if (!chunks || !chunks.length) return '';
  var p = Math.max(0, Math.min(0.999, Number(progress) || 0));
  return chunks[Math.floor(p * chunks.length)];
}

// 難字底線是對「整句」的字元位移，只顯示其中一片就會整個對不上。
// 位移到片段自己的座標系，片段外的丟掉。
//
// 切片會正規化空白，所以片段不一定是原句的字面子字串。找不到時回空陣列而不是
// 猜——少一條底線讀者沒損失，底線畫錯字會教錯東西。
function marksForChunk(marks, text, chunk) {
  if (!marks || !marks.length || !chunk) return [];
  var at = String(text == null ? '' : text).indexOf(chunk);
  if (at < 0) return [];
  var end = at + chunk.length;
  var out = [];
  for (var i = 0; i < marks.length; i++) {
    var m = marks[i];
    if (m.start >= at && m.end <= end) {
      out.push(Object.assign({}, m, { start: m.start - at, end: m.end - at }));
    }
  }
  return out;
}

// 整件事：此刻原文與譯文各該顯示哪一片。
//
// 片數多的那一軌定節拍，另一軌按比例攤在同樣的拍子上。曾經為了對齊而把較短的
// 那軌重切，結果重切出來的片數可能比拍子多，超出的尾巴永遠不會被顯示——重複
// 一行只是難看，一整句話消失不是。
function visibleCue(opts) {
  opts = opts || {};
  var maxLines = opts.maxLines > 0 ? opts.maxLines : DEFAULT_MAX_LINES;
  var enMax = charsPerLine(opts.widthPx, opts.fontSize, false, opts.latinRatio) * maxLines;
  var zhMax = charsPerLine(opts.widthPx, Math.round(opts.fontSize * 0.8), true, opts.latinRatio) * maxLines;

  var enChunks = chunkText(opts.en, enMax);
  var zhChunks = chunkText(opts.zh, zhMax);

  var steps = Math.max(enChunks.length, zhChunks.length, 1);
  var p = Math.max(0, Math.min(0.999, Number(opts.progress) || 0));
  var step = Math.floor(p * steps);

  function pick(list) {
    if (!list.length) return '';
    return list[Math.min(list.length - 1, Math.floor(step * list.length / steps))];
  }

  var en = pick(enChunks);
  return {
    en: en,
    zh: pick(zhChunks),
    steps: steps,
    step: step,
    marks: marksForChunk(opts.marks, opts.en, en)
  };
}

// 0..1：這一刻走到這個 cue 的幾分之幾。給 visibleCue 餵 progress 用。
function cueProgress(cue, currentTime) {
  if (!cue) return 0;
  var span = Number(cue.end) - Number(cue.start);
  if (!(span > 0)) return 0;
  return Math.max(0, Math.min(0.999, (Number(currentTime) - Number(cue.start)) / span));
}

/* ------------------------------------------------------------------ *
 * 二、放在哪：錨邊 + 位移 ↔ 絕對座標
 * ------------------------------------------------------------------ */

// 儲存形式是「哪一邊 + 距離那一邊多遠」，因為 CSS 要的是這個，而且視窗改變大
// 小時它才撐得住。拖曳用的是絕對 top，所以需要兩邊互換。

var DRAG_THRESHOLD = 4;        // 小於此距離的按放是「點擊」不是「拖曳」
var MIN_WIDTH_PCT = 20;
var MAX_WIDTH_PCT = 100;
var MIN_FONT = 10;
var MAX_FONT = 144;

function clampTop(o) {
  var limit = Math.max(0, o.areaHeight - o.boxHeight);
  if (!isFinite(o.top)) return 0;
  return Math.min(limit, Math.max(0, o.top));
}

function anchorToTop(o) {
  var raw = o.position === 'top' ? o.offset : o.areaHeight - o.boxHeight - o.offset;
  return clampTop({ top: raw, boxHeight: o.boxHeight, areaHeight: o.areaHeight });
}

// 放開時該掛哪一邊：落在哪半邊就掛哪邊。這不是美觀問題——停在畫面上緣卻存成
// 「距離下緣 N」的字幕，視窗一變矮就會往下滑過整個畫面。
function dropAnchor(o) {
  var settled = clampTop(o);
  var centre = settled + o.boxHeight / 2;
  if (centre < o.areaHeight / 2) {
    return { position: 'top', offset: Math.round(settled) };
  }
  return {
    position: 'bottom',
    offset: Math.round(Math.max(0, o.areaHeight - o.boxHeight - settled))
  };
}

// 視窗變小以後，存起來的位移可能已經把框推出畫面。重算一次讓它回到畫面內，
// 而且維持原本的錨邊。ReVid 沒有這道，縮視窗就會看到字幕被切掉。
function fitInside(o) {
  var top = anchorToTop(o);
  return dropAnchor({ top: top, boxHeight: o.boxHeight, areaHeight: o.areaHeight });
}

/* ------------------------------------------------------------------ *
 * 三、多大：側邊拉寬度、四角等比縮放
 * ------------------------------------------------------------------ */

// 框是置中的，所以拉一邊等於兩邊一起動：游標外移 100px，框寬增加 200px。
// 用百分比是因為畫面會隨視窗改變大小，px 寬度換個視窗就不合身。
function widthPctFrom(o) {
  if (!(o.areaWidth > 0)) return MAX_WIDTH_PCT;
  var halfWidth = Math.abs(o.pointerX - o.centreX);
  var pct = Math.round((halfWidth * 2 / o.areaWidth) * 100);
  return Math.min(MAX_WIDTH_PCT, Math.max(MIN_WIDTH_PCT, pct));
}

// 四角＝整體等比縮放（框、背景、文字一起），跟任何編輯器的角控點一樣。
//
// 比例是「先夾再套用」，不是寬度和字級各自夾：讓其中一個先撞到上限、另一個繼
// 續長，正是「等比」不再等比的原因，然後文字就爬出自己的框了。
function scaleFrom(o) {
  var half = Math.max(8, Math.abs(o.pointerX - o.centreX));
  var base = Math.max(8, o.startHalfWidth);

  var lowest = Math.max(MIN_WIDTH_PCT / o.startWidthPct, MIN_FONT / o.startFont);
  var highest = Math.min(MAX_WIDTH_PCT / o.startWidthPct, MAX_FONT / o.startFont);
  var ratio = Math.min(highest, Math.max(lowest, half / base));

  return {
    widthPct: Math.round(o.startWidthPct * ratio),
    fontSize: Math.round(o.startFont * ratio)
  };
}

// 垂直滑桿的上限。停在「框會開始離開畫面」的地方，而不是畫面高度——位移量到
// 的是框的近邊，最後一個框高的行程會把它推到看不見。用字級推估而不是實測，
// 否則 cue 在一行與兩行之間變動時，滑桿的行程會自己跳來跳去。
function maxOffsetFor(o) {
  var guess = o.fontSize * 2.8 + 16;
  return Math.max(120, Math.round(o.areaHeight - guess));
}

module.exports = {
  // 顯示什麼
  charsPerLine: charsPerLine,
  chunkText: chunkText,
  chunkAt: chunkAt,
  marksForChunk: marksForChunk,
  visibleCue: visibleCue,
  cueProgress: cueProgress,
  DEFAULT_MAX_LINES: DEFAULT_MAX_LINES,
  // 放在哪
  clampTop: clampTop,
  anchorToTop: anchorToTop,
  dropAnchor: dropAnchor,
  fitInside: fitInside,
  // 多大
  widthPctFrom: widthPctFrom,
  scaleFrom: scaleFrom,
  maxOffsetFor: maxOffsetFor,
  // 常數
  DRAG_THRESHOLD: DRAG_THRESHOLD,
  MIN_WIDTH_PCT: MIN_WIDTH_PCT,
  MAX_WIDTH_PCT: MAX_WIDTH_PCT,
  MIN_FONT: MIN_FONT,
  MAX_FONT: MAX_FONT
};
