import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Parsing lives in the main process, where the files are.
const require = createRequire(import.meta.url);
const {
    normaliseChapters, parseChapterJson, parseChapterVtt
} = require('../../electron/chapters.cjs');

// The real shape, from the sidecar the user's script writes.
const SAMPLE = JSON.stringify({
    version: 1,
    title: 'Some clip',
    file: 'Some clip.mp4',
    duration: 497.223,
    source: { page: 'https://example.com/v/1', site: 'example.com' },
    chapters: [
        { t: 31.72, end: 67.15, label: 'one', color: '#ef4444' },
        { t: 93.22, end: 108.03, label: 'two', color: '#3b82f6' },
        { t: 121.2, end: 164.93, label: 'three' }
    ]
});

test('the sidecar parses, metadata and all', () => {
    const r = parseChapterJson(SAMPLE);
    assert.equal(r.chapters.length, 3);
    assert.equal(r.title, 'Some clip');
    assert.equal(r.duration, 497.223);
    assert.equal(r.source.site, 'example.com');
    assert.equal(r.chapters[0].color, '#ef4444');
    assert.equal(r.chapters[2].color, undefined);
});

test('junk in does not become junk out', () => {
    assert.equal(parseChapterJson('not json'), null);
    assert.equal(parseChapterJson('{}'), null);
    assert.equal(parseChapterJson('{"chapters":[]}'), null);
    assert.equal(parseChapterJson(JSON.stringify({ chapters: [{ t: 5 }] })), null);   // no label
});

test('entries without a usable start or label are dropped', () => {
    const r = normaliseChapters([
        { t: 10, end: 20, label: 'keep' },
        { t: -5, label: 'negative' },
        { t: 'abc', label: 'not a number' },
        { t: 30, label: '   ' },
        { t: 40, label: 'keep too' }
    ]);
    assert.deepEqual(r.map(c => c.label), ['keep', 'keep too']);
});

test('they come back in time order however they arrived', () => {
    const r = normaliseChapters([
        { t: 90, label: 'late' }, { t: 10, label: 'early' }, { t: 50, label: 'middle' }
    ]);
    assert.deepEqual(r.map(c => c.label), ['early', 'middle', 'late']);
});

// Losing the start too would throw away the only half that matters.
test('a backwards or missing end becomes a point marker, not a deletion', () => {
    const r = normaliseChapters([
        { t: 10, end: 5, label: 'backwards' },
        { t: 20, end: 20, label: 'zero length' },
        { t: 30, label: 'no end at all' }
    ]);
    assert.equal(r.length, 3);
    assert.deepEqual(r.map(c => c.end), [null, null, null]);
});

test('only a real colour is kept', () => {
    const r = normaliseChapters([
        { t: 1, label: 'a', color: '#ef4444' },
        { t: 2, label: 'b', color: 'red' },
        { t: 3, label: 'c', color: '#fff' },
        { t: 4, label: 'd', color: 123 }
    ]);
    assert.deepEqual(r.map(c => c.color), ['#ef4444', undefined, '#fff', undefined]);
});


// --- the vtt fallback ---

const VTT = `WEBVTT

1
00:00:31.720 --> 00:01:07.150
first one

2
00:01:33.220 --> 00:01:48.030
second one
`;

test('the vtt carries the same ranges', () => {
    const r = parseChapterVtt(VTT);
    assert.equal(r.length, 2);
    assert.equal(r[0].label, 'first one');
    assert.ok(Math.abs(r[0].t - 31.72) < 0.001);
    assert.ok(Math.abs(r[0].end - 67.15) < 0.001);
    assert.equal(r[0].color, undefined);
});

test('mm:ss stamps work too, and a blank file is empty not broken', () => {
    const r = parseChapterVtt('WEBVTT\n\n01:05.500 --> 02:10.000\nshort form\n');
    assert.ok(Math.abs(r[0].t - 65.5) < 0.001);
    assert.deepEqual(parseChapterVtt('WEBVTT\n'), []);
    assert.deepEqual(parseChapterVtt(''), []);
    assert.deepEqual(parseChapterVtt(null), []);
});
