import test from 'node:test';
import assert from 'node:assert/strict';
import { PAD, clipFor, retimeCues, totalDuration } from './reelSegments.js';

const cues = [
    { start: 10, end: 12, text: 'one' },
    { start: 12, end: 14, text: 'two' },
    { start: 30, end: 33, text: 'three' },
    { start: 50, end: 52, text: 'four' }
];

// Two picks: lines 0-1 joined, then line 3.
const ranges = [
    { startIndex: 0, endIndex: 1, start: 10, end: 14 },
    { startIndex: 3, endIndex: 3, start: 50, end: 52 }
];

test('clip is padded at both ends and never seeks before zero', () => {
    assert.deepEqual(clipFor({ startIndex: 0, endIndex: 0, start: 10, end: 12 }), {
        start: 10 - PAD.start,
        duration: (12 + PAD.end) - (10 - PAD.start)
    });

    const atHead = clipFor({ startIndex: 0, endIndex: 0, start: 0.05, end: 2 });
    assert.equal(atHead.start, 0);
    assert.equal(atHead.duration, 2 + PAD.end);
});

test('cues are retimed onto the joined timeline', () => {
    const segs = retimeCues(cues, ranges);
    assert.equal(segs.length, 3);

    // First clip starts at 10 - PAD.start, so cue at 10 lands at PAD.start.
    assert.equal(segs[0].text, 'one');
    assert.equal(round(segs[0].start), PAD.start);
    assert.equal(round(segs[0].end), PAD.start + 2);

    assert.equal(segs[1].text, 'two');
    assert.equal(round(segs[1].start), PAD.start + 2);

    // Second clip is appended after the first clip's full padded duration.
    const firstClip = clipFor(ranges[0]);
    assert.equal(segs[2].text, 'four');
    assert.equal(round(segs[2].start), round(firstClip.duration + PAD.start));
});

test('a cue never lands before its own clip', () => {
    for (const s of retimeCues(cues, ranges)) {
        assert.ok(s.start >= 0, `segment started at ${s.start}`);
        assert.ok(s.end > s.start);
    }
});

test('clipped head shifts its cues by the smaller pad', () => {
    // Range starting at 0.05 can only pad back to 0, so the cue sits at 0.05
    // rather than at PAD.start — otherwise subtitles run ahead of the picture.
    const near = [{ start: 0.05, end: 2, text: 'edge' }];
    const segs = retimeCues(near, [{ startIndex: 0, endIndex: 0, start: 0.05, end: 2 }]);
    assert.equal(round(segs[0].start), 0.05);
});

test('ranges carrying no cues contribute nothing but still take time', () => {
    const segs = retimeCues(cues, [
        { startIndex: 2, endIndex: 2, start: 30, end: 33 },
        { startIndex: 3, endIndex: 3, start: 50, end: 52 }
    ]);
    assert.deepEqual(segs.map(s => s.text), ['three', 'four']);
});

test('total duration is the sum of padded clips', () => {
    const expected = ranges.reduce((n, r) => n + clipFor(r).duration, 0);
    assert.equal(round(totalDuration(ranges)), round(expected));
});

test('zh is carried through as a second line when present', () => {
    const bilingual = [{ start: 10, end: 12, text: 'hello', zh: '你好' }];
    const segs = retimeCues(bilingual, [{ startIndex: 0, endIndex: 0, start: 10, end: 12 }]);
    assert.equal(segs[0].text, 'hello\n你好');
});

const round = (n) => Math.round(n * 1000) / 1000;
