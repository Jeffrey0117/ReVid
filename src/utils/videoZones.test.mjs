import test from 'node:test';
import assert from 'node:assert/strict';
import { zoneAt, pictureBox, SIDE_FRACTION } from './videoZones.js';

test('each third claims its own strip', () => {
    assert.equal(zoneAt(50, 900), 'left');
    assert.equal(zoneAt(450, 900), 'middle');
    assert.equal(zoneAt(850, 900), 'right');
});

test('the boundaries belong to the middle, not the sides', () => {
    // Exactly on the line is the safe choice: the middle only pauses.
    assert.equal(zoneAt(300, 900), 'middle');
    assert.equal(zoneAt(600, 900), 'middle');
    assert.equal(zoneAt(299, 900), 'left');
    assert.equal(zoneAt(601, 900), 'right');
});

test('the very edges still resolve', () => {
    assert.equal(zoneAt(0, 900), 'left');
    assert.equal(zoneAt(900, 900), 'right');
});

// A zero-width or unmeasured player must not report a side, or a stray click
// during layout would jump an episode.
test('an unmeasured player is all middle', () => {
    assert.equal(zoneAt(50, 0), 'middle');
    assert.equal(zoneAt(NaN, 900), 'middle');
    assert.equal(zoneAt(50, NaN), 'middle');
    assert.equal(zoneAt(undefined, undefined), 'middle');
});

test('the sides are reachable without aiming', () => {
    assert.ok(SIDE_FRACTION >= 0.2 && SIDE_FRACTION <= 0.4);
});

// --- where the picture actually is inside the element ---

test('a letterboxed video reports the picture, not the element', () => {
    // The reported case: 16:9 inside a tall narrow box.
    const p = pictureBox({ elW: 299, elH: 1016, videoW: 1280, videoH: 720 });
    assert.equal(Math.round(p.width), 299);
    assert.equal(Math.round(p.height), 168);
    assert.ok(p.top > 400, `picture should be centred, got top=${p.top}`);
    assert.equal(Math.round(p.left), 0);
});

test('pillarboxing works the same way round', () => {
    const p = pictureBox({ elW: 1000, elH: 300, videoW: 1280, videoH: 720 });
    assert.equal(Math.round(p.height), 300);
    assert.equal(Math.round(p.width), 533);
    assert.ok(p.left > 200);
    assert.equal(Math.round(p.top), 0);
});

test('an exact fit has no bars', () => {
    const p = pictureBox({ elW: 1280, elH: 720, videoW: 1280, videoH: 720 });
    assert.deepEqual(
        [p.left, p.top, p.width, p.height],
        [0, 0, 1280, 720]
    );
});

// Before metadata arrives there is no aspect ratio to work with, and
// guessing one would move things twice.
test('unknown dimensions fall back to the whole element', () => {
    for (const bad of [
        { elW: 800, elH: 450, videoW: 0, videoH: 0 },
        { elW: 800, elH: 450, videoW: 1280, videoH: 0 },
        { elW: 0, elH: 0, videoW: 1280, videoH: 720 },
        {}
    ]) {
        const p = pictureBox(bad);
        assert.equal(p.left, 0);
        assert.equal(p.top, 0);
        assert.equal(p.width, bad.elW);
        assert.equal(p.height, bad.elH);
    }
});
