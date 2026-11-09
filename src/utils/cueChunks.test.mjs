import test from 'node:test';
import assert from 'node:assert/strict';
import {
    chunkText, chunkAt, visibleCue, charsPerLine, marksForChunk, MAX_LINES
} from './cueChunks.js';

// The cue from the report, exactly as whisper produced it.
const EN = "Excuse me, excuse me, Hi, I'm Jake Peralta, so thrilled to be here today, as many of you";
const ZH = '對不起，對不起，嗨，我是傑克・佩拉爾塔，很高興今天能和你們一樣來到這裡';

test('a short line is left alone', () => {
    assert.deepEqual(chunkText('Not now, Terry.', 40), ['Not now, Terry.']);
});

test('a long line is broken up rather than wrapped forever', () => {
    const chunks = chunkText(EN, 40);
    assert.ok(chunks.length > 1, 'nothing was split');
    for (const c of chunks) assert.ok(c.length <= 40, `"${c}" is ${c.length} chars`);
});

test('nothing is lost in the splitting', () => {
    const rejoined = chunkText(EN, 40).join(' ').replace(/\s+/g, ' ');
    const original = EN.replace(/\s+/g, ' ');
    assert.equal(rejoined, original);
});

test('it breaks where a reader would, not mid-word', () => {
    for (const c of chunkText(EN, 40)) {
        assert.ok(!/^\w/.test(c) || !c.startsWith('m,'), `broke mid-word: "${c}"`);
    }
    // The first piece should end on punctuation given the chance.
    assert.match(chunkText(EN, 40)[0], /[,.!?]$/);
});

test('Chinese splits too, having no spaces to break on', () => {
    const chunks = chunkText(ZH, 16);
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.length <= 16, `"${c}" is ${c.length} chars`);
    assert.equal(chunks.join('').replace(/\s/g, ''), ZH.replace(/[\s]/g, '').replace(/，/g, '，'));
});

test('pieces appear in order across the cue', () => {
    const chunks = ['one', 'two', 'three'];
    assert.equal(chunkAt(chunks, 0), 'one');
    assert.equal(chunkAt(chunks, 0.5), 'two');
    assert.equal(chunkAt(chunks, 0.99), 'three');
    // Out of range is clamped rather than returning undefined.
    assert.equal(chunkAt(chunks, -1), 'one');
    assert.equal(chunkAt(chunks, 2), 'three');
});

test('an empty cue produces nothing to show', () => {
    assert.deepEqual(chunkText('', 40), []);
    assert.deepEqual(chunkText(null, 40), []);
    assert.equal(chunkAt([], 0.5), '');
});

// The point of the whole thing.
test('the reported cue fits two lines on a phone instead of eight', () => {
    const widthPx = 366;
    const fontSize = 20;
    const { en, zh } = visibleCue({ en: EN, zh: ZH, progress: 0, widthPx, fontSize });

    const enLines = Math.ceil(en.length / charsPerLine(widthPx, fontSize, false));
    const zhLines = Math.ceil(zh.length / charsPerLine(widthPx, Math.round(fontSize * 0.8), true));
    assert.ok(enLines <= MAX_LINES, `English took ${enLines} lines`);
    assert.ok(zhLines <= MAX_LINES, `Chinese took ${zhLines} lines`);
});

test('both languages advance together rather than drifting apart', () => {
    const seen = new Set();
    for (const p of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
        const v = visibleCue({ en: EN, zh: ZH, progress: p, widthPx: 366, fontSize: 20 });
        assert.ok(v.en.length > 0, `English blank at ${p}`);
        assert.ok(v.zh.length > 0, `Chinese blank at ${p}`);
        seen.add(v.en);
    }
    assert.ok(seen.size > 1, 'the English never advanced');
});

// Found by simulating the real cue: a break taken at the character just
// past the limit produced a 43-character piece against a 42-character
// budget, which is three lines instead of two.
test('no piece ever exceeds the limit it was given', () => {
    for (const max of [12, 20, 31, 42, 43, 60]) {
        for (const text of [EN, ZH, EN + ' ' + EN]) {
            for (const c of chunkText(text, max)) {
                assert.ok(c.length <= max, `"${c}" is ${c.length}, limit ${max}`);
            }
        }
    }
});

// Found by simulating the real cue, and the worst thing here: aligning the
// two languages by re-splitting the shorter one dropped its tail. The
// Chinese ended on "我是傑克・佩拉爾塔，" and the rest of the sentence was
// never shown at all.
test('every word of both languages reaches the screen', () => {
    for (const fontSize of [16, 20, 26, 30]) {
        const { steps } = visibleCue({ en: EN, zh: ZH, progress: 0, widthPx: 366, fontSize });
        let en = '';
        let zh = '';
        for (let s = 0; s < steps; s++) {
            const v = visibleCue({ en: EN, zh: ZH, progress: (s + 0.5) / steps, widthPx: 366, fontSize });
            if (!en.endsWith(v.en)) en += (en ? ' ' : '') + v.en;
            if (!zh.endsWith(v.zh)) zh += v.zh;
        }
        assert.equal(en.replace(/\s+/g, ' '), EN.replace(/\s+/g, ' '),
            `English was cut short at ${fontSize}px`);
        assert.equal(zh, ZH, `Chinese was cut short at ${fontSize}px`);
    }
});

test('a wide screen needs no splitting at all', () => {
    const v = visibleCue({ en: EN, zh: ZH, progress: 0, widthPx: 1600, fontSize: 20 });
    assert.equal(v.en, EN.replace(/\s+/g, ' '));
    assert.equal(v.steps, 1);
});

// --- difficulty underlines surviving a chunked cue ---

const CUE = 'Alright. I will fire Wilson. Romero is responsible for most of it.';

const markFor = (word) => {
    const start = CUE.indexOf(word);
    return { start, end: start + word.length, word };
};

test('marks are shifted into the piece they belong to', () => {
    const marks = [markFor('Wilson')];
    const piece = 'I will fire Wilson.';
    const out = marksForChunk(marks, CUE, piece);
    assert.equal(out.length, 1);
    assert.equal(piece.slice(out[0].start, out[0].end), 'Wilson');
});

test('a mark outside the piece is dropped, not clamped', () => {
    const marks = [markFor('Wilson')];
    assert.deepEqual(marksForChunk(marks, CUE, 'Romero is responsible for most of it.'), []);
});

test('a mark straddling the cut is dropped rather than half-drawn', () => {
    const marks = [{ start: 24, end: 35, word: 'on-Romero' }];
    assert.deepEqual(marksForChunk(marks, CUE, 'Alright. I will fire Wilson.'), []);
});

// Underlining the wrong word is worse than underlining nothing.
test('a piece that cannot be located yields no marks at all', () => {
    const marks = [{ start: 20, end: 26, word: 'Wilson' }];
    assert.deepEqual(marksForChunk(marks, CUE, 'text that is not in the cue'), []);
});

test('no marks, no text, no chunk: all empty, never a throw', () => {
    assert.deepEqual(marksForChunk(null, CUE, 'Alright.'), []);
    assert.deepEqual(marksForChunk([], CUE, 'Alright.'), []);
    assert.deepEqual(marksForChunk([{ start: 0, end: 3, word: 'Alr' }], CUE, ''), []);
    assert.deepEqual(marksForChunk([{ start: 0, end: 3, word: 'Alr' }], undefined, 'Alright.'), []);
});
