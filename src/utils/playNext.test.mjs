import test from 'node:test';
import assert from 'node:assert/strict';
import {
    nextInOrder, prevInOrder, shouldOfferNext, COUNTDOWN_SECONDS, deadlineFrom, secondsLeft
} from './playNext.js';

const list = ['e01.mp4', 'e02.mp4', 'e03.mp4'];

test('it follows the order on screen', () => {
    assert.equal(nextInOrder(list, 'e01.mp4'), 'e02.mp4');
    assert.equal(nextInOrder(list, 'e02.mp4'), 'e03.mp4');
});

// The `n` key wraps around. Doing that automatically means a season finale
// silently restarts the season, which nobody asked for.
test('the last one is the end, not a loop back to the first', () => {
    assert.equal(nextInOrder(list, 'e03.mp4'), null);
});

// nextVideo() walks the raw folder listing; the viewer shows a filtered,
// sorted, possibly pinned-only list. Advancing into something not on screen
// reads as the player losing its place.
test('a video that is not in the visible list has nothing to follow it', () => {
    assert.equal(nextInOrder(list, 'hidden.mp4'), null);
    assert.equal(nextInOrder(['pinned.mp4'], 'e01.mp4'), null);
});

test('the visible order wins over the folder order', () => {
    // Sorted newest-first in the grid: next means next *here*.
    const byDate = ['e03.mp4', 'e01.mp4', 'e02.mp4'];
    assert.equal(nextInOrder(byDate, 'e03.mp4'), 'e01.mp4');
});

test('an empty or missing list is not an error', () => {
    assert.equal(nextInOrder([], 'e01.mp4'), null);
    assert.equal(nextInOrder(null, 'e01.mp4'), null);
    assert.equal(nextInOrder(undefined, undefined), null);
});

test('it offers nothing unless the folder was switched on', () => {
    const base = { visibleFiles: list, current: 'e01.mp4', marking: false };
    assert.equal(shouldOfferNext({ ...base, enabled: false }), null);
    assert.equal(shouldOfferNext({ ...base, enabled: true }), 'e02.mp4');
});

// A half-made range selection is work in progress; advancing loses it.
test('it holds off while a range is half-marked', () => {
    assert.equal(shouldOfferNext({
        enabled: true, marking: true, visibleFiles: list, current: 'e01.mp4'
    }), null);
});

// This gate was first written as "editing", fed from the viewer's mode
// toggle. That mode is sticky — the user had left the editor open, so the
// feature was dead for them from the moment it shipped. Only an actual
// in-progress selection may hold it back.
test('merely having the editor open is not a reason to decline', () => {
    assert.equal(shouldOfferNext({
        enabled: true, marking: false, visibleFiles: list, current: 'e01.mp4'
    }), 'e02.mp4');
    // An absent flag reads as "not marking", never as "unknown, so refuse".
    assert.equal(shouldOfferNext({
        enabled: true, visibleFiles: list, current: 'e01.mp4'
    }), 'e02.mp4');
});

test('the countdown is long enough to catch but short enough to tolerate', () => {
    assert.ok(COUNTDOWN_SECONDS >= 3 && COUNTDOWN_SECONDS <= 10);
});

test('the countdown counts down and stops at zero', () => {
    const start = 1_000_000;
    const deadline = deadlineFrom(start);
    assert.equal(secondsLeft(deadline, start), COUNTDOWN_SECONDS);
    assert.equal(secondsLeft(deadline, start + 1000), COUNTDOWN_SECONDS - 1);
    assert.equal(secondsLeft(deadline, start + COUNTDOWN_SECONDS * 1000), 0);
    assert.equal(secondsLeft(deadline, start + 60_000), 0);
});

// The failure this shape exists to rule out: a re-render recomputing the
// remaining time must not restart it. Reading the same deadline at later and
// later clock values can only ever go down.
test('re-reading the deadline cannot reset the countdown', () => {
    const start = 1_000_000;
    const deadline = deadlineFrom(start);
    let previous = Infinity;
    // Past the deadline, not up to it: stepping by 137ms never lands on it.
    for (let ms = 0; ms <= COUNTDOWN_SECONDS * 1000 + 137; ms += 137) {
        const left = secondsLeft(deadline, start + ms);
        assert.ok(left <= previous, `went up at +${ms}ms: ${previous} -> ${left}`);
        previous = left;
    }
    assert.equal(previous, 0);
});

// --- stepping backwards, for the on-screen side zones ---

test('it steps back through the order on screen', () => {
    assert.equal(prevInOrder(list, 'e02.mp4'), 'e01.mp4');
    assert.equal(prevInOrder(list, 'e03.mp4'), 'e02.mp4');
});

test('the first one has nothing before it', () => {
    assert.equal(prevInOrder(list, 'e01.mp4'), null);
});

test('a video not on screen has nothing before it either', () => {
    assert.equal(prevInOrder(list, 'hidden.mp4'), null);
    assert.equal(prevInOrder([], 'e01.mp4'), null);
    assert.equal(prevInOrder(null, undefined), null);
});

test('forwards then back returns to where it started', () => {
    for (const f of list) {
        const next = nextInOrder(list, f);
        if (next) assert.equal(prevInOrder(list, next), f);
    }
});
