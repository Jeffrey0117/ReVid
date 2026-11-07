import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Tests the real main-process module rather than a copy of it.
const require = createRequire(import.meta.url);
const { matchCues, foldersInScope, PHRASE, TERMS } = require('../../electron/library-search.cjs');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const cues = [
    { start: 10, end: 12, text: 'Where were you on the night of the murder?' },
    { start: 12, end: 15, text: 'I was at the bar with Charles.', zh: '我跟查爾斯在酒吧。' },
    { start: 20, end: 22, text: 'The bar closed at midnight.' },
    { start: 30, end: 32, text: 'Nine-Nine!' }
];

test('a phrase match outranks a scattered-words match', () => {
    const hits = matchCues(cues, 'at the bar');
    assert.equal(hits[0].index, 1);
    assert.equal(hits[0].score, PHRASE);
});

test('all terms present anywhere in the line still matches', () => {
    const hits = matchCues(cues, 'bar midnight');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].index, 2);
    assert.equal(hits[0].score, TERMS);
});

test('a line missing any term does not match', () => {
    assert.equal(matchCues(cues, 'bar spaceship').length, 0);
});

test('matching ignores case', () => {
    assert.equal(matchCues(cues, 'CHARLES').length, 1);
    assert.equal(matchCues(cues, 'charles').length, 1);
});

test('the translation is searched too', () => {
    const hits = matchCues(cues, '酒吧');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].index, 1);
});

test('Chinese queries match without spaces to split on', () => {
    assert.equal(matchCues(cues, '查爾斯').length, 1);
});

test('results carry what is needed to jump to the moment', () => {
    const [hit] = matchCues(cues, 'murder');
    assert.equal(hit.start, 10);
    assert.equal(hit.text, cues[0].text);
});

test('results are ordered by score, then by time', () => {
    const hits = matchCues(cues, 'bar');
    assert.deepEqual(hits.map(h => h.index), [1, 2]);
    assert.ok(hits.every(h => h.score === PHRASE));
});

test('an empty or whitespace query matches nothing', () => {
    for (const q of ['', '   ', null, undefined]) {
        assert.deepEqual(matchCues(cues, q), []);
    }
});

test('punctuation in the query does not stop a match', () => {
    assert.equal(matchCues(cues, 'Nine-Nine!').length, 1);
});

test('a missing cue list is tolerated', () => {
    assert.deepEqual(matchCues(null, 'bar'), []);
    assert.deepEqual(matchCues([], 'bar'), []);
});

// Regression: the folder being viewed arrived with forward slashes while the
// sibling scan built backslashes, so the same folder was listed twice and
// every one of its hits appeared twice with the episode count doubled.
test('the current folder is not listed twice when its separators differ', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'revid-scope-'));
    const season = path.join(root, 's2');
    fs.mkdirSync(season);
    fs.writeFileSync(path.join(season, 's2.revid'), JSON.stringify({ videos: {} }));

    try {
        const slashed = season.split(path.sep).join('/');
        const dirs = foldersInScope(slashed, 'siblings');
        const seen = dirs.map(d => path.resolve(d).toLowerCase());
        assert.equal(new Set(seen).size, seen.length, `duplicated: ${dirs.join(' | ')}`);
        assert.equal(dirs.length, 1);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a regex-looking query is treated as text, not a pattern', () => {
    // '.*' must not match everything — it is a user typing, not an engine.
    assert.deepEqual(matchCues(cues, '.*'), []);
});
