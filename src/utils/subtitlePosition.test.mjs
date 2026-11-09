import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorToTop, dropAnchor, clampTop, DRAG_THRESHOLD } from './subtitlePosition.js';

const area = { boxHeight: 60, areaHeight: 600 };

test('the stored bottom offset becomes a top the drag can work in', () => {
    // 76px up from the bottom of a 600px area, box 60 tall.
    assert.equal(anchorToTop({ position: 'bottom', offset: 76, ...area }), 464);
    assert.equal(anchorToTop({ position: 'top', offset: 40, ...area }), 40);
});

test('a drop in the lower half hangs from the bottom', () => {
    const r = dropAnchor({ top: 464, ...area });
    assert.deepEqual(r, { position: 'bottom', offset: 76 });
});

// Anchoring matters on resize: a subtitle near the top that is stored as a
// bottom offset slides down the picture when the window gets shorter.
test('a drop in the upper half hangs from the top', () => {
    const r = dropAnchor({ top: 40, ...area });
    assert.deepEqual(r, { position: 'top', offset: 40 });
});

test('dropping and re-reading lands in the same place', () => {
    for (const top of [0, 17, 180, 299, 301, 420, 540]) {
        const stored = dropAnchor({ top, ...area });
        const back = anchorToTop({ ...stored, ...area });
        assert.equal(back, top, `round trip failed at ${top}`);
    }
});

// The user asked for a subtitle that can sit over the top of the picture, so
// the range is the whole frame, not a safe margin inside it.
test('the whole frame is reachable, top edge included', () => {
    assert.deepEqual(dropAnchor({ top: 0, ...area }), { position: 'top', offset: 0 });
    assert.equal(anchorToTop({ position: 'top', offset: 0, ...area }), 0);
});

test('it cannot be dragged out of the frame', () => {
    assert.equal(clampTop({ top: -200, ...area }), 0);
    assert.equal(clampTop({ top: 9999, ...area }), 540);
    assert.deepEqual(dropAnchor({ top: 9999, ...area }), { position: 'bottom', offset: 0 });
});

// A box taller than the frame has nowhere to go, so which edge it hangs from
// is arbitrary — what matters is that it is pinned and the offset never goes
// negative, which CSS would read as pushing it off the picture entirely.
test('a box taller than the frame is pinned rather than negative', () => {
    const tall = { boxHeight: 800, areaHeight: 600 };
    assert.equal(clampTop({ top: 100, ...tall }), 0);
    const r = dropAnchor({ top: 100, ...tall });
    assert.equal(r.offset, 0);
    assert.ok(r.position === 'top' || r.position === 'bottom');
});

test('a nonsense measurement does not produce NaN geometry', () => {
    assert.equal(clampTop({ top: NaN, ...area }), 0);
    assert.equal(Number.isFinite(anchorToTop({ position: 'bottom', offset: 76, ...area })), true);
});

test('the click/drag threshold is small enough not to swallow word taps', () => {
    assert.ok(DRAG_THRESHOLD > 0 && DRAG_THRESHOLD <= 8);
});
