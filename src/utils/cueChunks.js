// Subtitles are read in glances, so they are shown two lines at a time.
//
// Whisper emits a cue per utterance, and an utterance can be ninety
// characters — "Excuse me, excuse me, Hi, I'm Jake Peralta, so thrilled to
// be here today, as many of you". Rendered as one subtitle that is four
// lines of English stacked on four of Chinese, covering the picture. No
// amount of shrinking the type fixes that; the cue has to be shown in
// pieces, each for its share of the cue's time.

export const MAX_LINES = 2;

// Prefer a break the sentence already offers, then a word gap, then — for
// Chinese, which has neither — anywhere.
const BREAK_AFTER = /[.!?。！？]/;
const SOFT_AFTER = /[,;:，；：、]/;

const isCjk = (ch) => /[　-鿿豈-﫿＀-￯]/.test(ch);

// Characters that fit on one line at this size and width. CJK glyphs are
// about twice as wide, so a mixed line is measured by its heavier half.
export function charsPerLine(widthPx, fontSize, cjk) {
    const per = fontSize * (cjk ? 1.0 : 0.56);
    return Math.max(6, Math.floor(widthPx / per));
}

// Split into pieces that each fit MAX_LINES, breaking where a reader would.
export function chunkText(text, maxChars) {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    if (clean.length <= maxChars) return [clean];

    const chunks = [];
    let rest = clean;

    while (rest.length > maxChars) {
        // Exactly maxChars: taking a break at the last index gives a cut of
        // maxChars, never one past it. Searching a character further turned
        // a 42-character limit into 43 and a two-line piece into three.
        const window = rest.slice(0, maxChars);
        let cut = -1;

        // A sentence end inside the window is the best place to stop.
        for (let i = window.length - 1; i >= Math.floor(maxChars * 0.4); i--) {
            if (BREAK_AFTER.test(window[i])) { cut = i + 1; break; }
        }
        // Then a comma or similar.
        if (cut < 0) {
            for (let i = window.length - 1; i >= Math.floor(maxChars * 0.4); i--) {
                if (SOFT_AFTER.test(window[i])) { cut = i + 1; break; }
            }
        }
        // Then a word gap, for text that has them.
        if (cut < 0) {
            const gap = window.lastIndexOf(' ');
            if (gap >= Math.floor(maxChars * 0.4)) cut = gap;
        }
        // Chinese has none of the above; break on the character.
        if (cut < 0) cut = maxChars;

        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
    }
    if (rest) chunks.push(rest);
    return chunks.filter(Boolean);
}

// Which piece belongs on screen, given how far through the cue we are.
// Split evenly: the alternative is weighting by length, which makes short
// pieces flash by too fast to read.
export function chunkAt(chunks, progress) {
    if (chunks.length === 0) return '';
    const p = Math.max(0, Math.min(0.999, progress));
    return chunks[Math.floor(p * chunks.length)];
}

// Difficulty underlines are character offsets into the whole cue, so showing
// one piece of it moves every word out from under its mark. Shift them into
// the piece's own coordinates and drop the ones that fall outside it.
//
// Chunking normalises whitespace, so a piece is not always a literal slice of
// the source. When it cannot be located exactly, this returns nothing rather
// than a guess: a missing underline costs the reader little, one drawn under
// the wrong word teaches them something false. Words stay clickable either
// way — the underline is the only thing at stake.
export function marksForChunk(marks, text, chunk) {
    if (!marks?.length || !chunk) return [];
    const at = (text || '').indexOf(chunk);
    if (at < 0) return [];
    const end = at + chunk.length;
    return marks
        .filter(m => m.start >= at && m.end <= end)
        .map(m => ({ ...m, start: m.start - at, end: m.end - at }));
}

// The whole job: what English and Chinese should read right now.
export function visibleCue({ en, zh, progress, widthPx, fontSize }) {
    const enMax = charsPerLine(widthPx, fontSize, false) * MAX_LINES;
    const zhMax = charsPerLine(widthPx, Math.round(fontSize * 0.8), true) * MAX_LINES;

    const enChunks = chunkText(en, enMax);
    const zhChunks = chunkText(zh, zhMax);

    // Whichever needs more pieces sets the pace, and the other is stretched
    // across those beats proportionally — so a shorter list repeats a piece
    // rather than its tail never being reached.
    //
    // Re-splitting the shorter one to match looked tidier and silently lost
    // text: re-splitting can yield *more* pieces than there are beats, and
    // the ones past the end were simply never shown. A repeated line is a
    // cosmetic flaw; a sentence that never appears is not.
    const steps = Math.max(enChunks.length, zhChunks.length, 1);
    const p = Math.max(0, Math.min(0.999, progress));
    const step = Math.floor(p * steps);

    const pick = (list) => (
        list.length ? list[Math.min(list.length - 1, Math.floor(step * list.length / steps))] : ''
    );
    return { en: pick(enChunks), zh: pick(zhChunks), steps };
}
