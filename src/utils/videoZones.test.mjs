import test from 'node:test';
import assert from 'node:assert/strict';
import { zoneAt, SIDE_FRACTION } from './videoZones.js';

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
