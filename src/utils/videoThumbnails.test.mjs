import test from 'node:test';
import assert from 'node:assert/strict';
import { MIDDLE, seekTargetFor } from './videoThumbnails.js';

test('the default grabs the middle of the episode, not its opening', () => {
    assert.equal(seekTargetFor(1320, MIDDLE), 660);
    assert.equal(seekTargetFor(60, MIDDLE), 30);
});

test('a one-second thumbnail of a long video was the fade from black', () => {
    // The old behaviour, kept for anyone asking for a specific second.
    assert.equal(seekTargetFor(1320, 1), 1);
});

test('an explicit second is still pulled back inside a very short clip', () => {
    // 10 seconds long: asking for second 5 would be past the useful part.
    assert.equal(seekTargetFor(10, 5), 1);
});

test('an unknown duration does not produce a NaN seek', () => {
    for (const duration of [0, NaN, undefined, null, Infinity]) {
        assert.ok(Number.isFinite(seekTargetFor(duration, MIDDLE)),
            `middle gave a bad seek for duration ${duration}`);
        assert.ok(Number.isFinite(seekTargetFor(duration, 2)),
            `explicit gave a bad seek for duration ${duration}`);
    }
});

test('the seek never lands past the end', () => {
    for (const duration of [5, 60, 1320, 7200]) {
        assert.ok(seekTargetFor(duration, MIDDLE) < duration);
    }
});
