import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    chapterAt, chapterBands, nextChapter, prevChapter, POINT_WIDTH_PCT
} from './chapters.js';

// The renderer half only ever sees chapters that already came out of the
// library, so the fixtures go through the same cleaning the library applies.
const require = createRequire(import.meta.url);
const { normaliseChapters } = require('../../electron/chapters.cjs');

// --- which chapter is playing ---

const CH = normaliseChapters([
    { t: 30, end: 60, label: 'one' },
    { t: 90, end: 120, label: 'two' },
    { t: 150, label: 'open ended' }
]);

// Chapters are not subtitles: they do not tile the timeline, and most of a
// video belongs to no chapter at all.
test('the gaps between chapters really are gaps', () => {
    assert.equal(chapterAt(CH, 0), null);
    assert.equal(chapterAt(CH, 29.9), null);
    assert.equal(chapterAt(CH, 75), null);        // between one and two
    assert.equal(chapterAt(CH, 135), null);       // between two and three
});

test('inside a chapter it names it', () => {
    assert.equal(chapterAt(CH, 30).label, 'one');
    assert.equal(chapterAt(CH, 59.9).label, 'one');
    assert.equal(chapterAt(CH, 95).label, 'two');
});

test('the end is exclusive, so touching ranges never double up', () => {
    assert.equal(chapterAt(CH, 60), null);
    assert.equal(chapterAt(normaliseChapters([
        { t: 0, end: 10, label: 'a' }, { t: 10, end: 20, label: 'b' }
    ]), 10).label, 'b');
});

test('an open-ended chapter runs to the end of the video', () => {
    assert.equal(chapterAt(CH, 150).label, 'open ended');
    assert.equal(chapterAt(CH, 99999).label, 'open ended');
});

test('nonsense time or list returns nothing rather than throwing', () => {
    assert.equal(chapterAt(CH, NaN), null);
    assert.equal(chapterAt(null, 10), null);
    assert.equal(chapterAt([], 10), null);
});

// --- bands on the progress bar ---

test('a band sits where its chapter sits', () => {
    const b = chapterBands(normaliseChapters([{ t: 25, end: 50, label: 'a' }]), 100);
    assert.equal(b[0].left, 25);
    assert.equal(b[0].width, 25);
});

// Stretching it to the next chapter would claim time the marker never
// said anything about.
test('a point marker gets a hairline, not the space up to the next one', () => {
    const b = chapterBands(normaliseChapters([
        { t: 10, label: 'point' }, { t: 90, end: 95, label: 'range' }
    ]), 100);
    assert.equal(b[0].width, POINT_WIDTH_PCT);
});

test('a band never runs off the end of the bar', () => {
    const b = chapterBands(normaliseChapters([{ t: 90, end: 500, label: 'over' }]), 100);
    assert.ok(b[0].left + b[0].width <= 100.001, `${b[0].left} + ${b[0].width}`);
});

test('no duration means no bands rather than a divide by zero', () => {
    assert.deepEqual(chapterBands(CH, 0), []);
    assert.deepEqual(chapterBands(CH, undefined), []);
    assert.deepEqual(chapterBands(null, 100), []);
});

// --- skipping ---

test('next goes to the following start', () => {
    assert.equal(nextChapter(CH, 0).label, 'one');
    assert.equal(nextChapter(CH, 45).label, 'two');
    assert.equal(nextChapter(CH, 160), null);
});

// The behaviour every media player has: the first press restarts the
// chapter you are in, the second takes you back one.
test('previous restarts the current chapter before leaving it', () => {
    assert.equal(prevChapter(CH, 50).label, 'one');      // 20s in: back to its start
    assert.equal(prevChapter(CH, 31).label, 'one');      // 1s in: too soon, so the one before
    assert.equal(prevChapter(CH, 95).label, 'two');
    assert.equal(prevChapter(CH, 91).label, 'one');
    assert.equal(prevChapter(CH, 10), null);
});

