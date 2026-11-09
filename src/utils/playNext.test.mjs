import test from 'node:test';
import assert from 'node:assert/strict';
import { nextInOrder, shouldOfferNext, COUNTDOWN_SECONDS } from './playNext.js';

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
    const base = { visibleFiles: list, current: 'e01.mp4', editing: false };
    assert.equal(shouldOfferNext({ ...base, enabled: false }), null);
    assert.equal(shouldOfferNext({ ...base, enabled: true }), 'e02.mp4');
});

// Every click in the editor may be setting a cut point; the video ending
// must not move the file out from under that.
test('it never fires while the editor is open', () => {
    assert.equal(shouldOfferNext({
        enabled: true, editing: true, visibleFiles: list, current: 'e01.mp4'
    }), null);
});

test('the countdown is long enough to catch but short enough to tolerate', () => {
    assert.ok(COUNTDOWN_SECONDS >= 3 && COUNTDOWN_SECONDS <= 10);
});
