import test from 'node:test';
import assert from 'node:assert/strict';
import {
    anchorToTop, dropAnchor, clampTop, DRAG_THRESHOLD,
    widthPctFrom, scaleFrom, MIN_WIDTH_PCT, MAX_WIDTH_PCT, MIN_FONT, MAX_FONT
} from './subtitlePosition.js';

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

// --- resizing ---

// The box is centred, so one side moving out widens it by twice as much.
test('dragging a side out widens the box from both sides', () => {
    assert.equal(widthPctFrom({ pointerX: 900, centreX: 500, areaWidth: 1000 }), 80);
    assert.equal(widthPctFrom({ pointerX: 100, centreX: 500, areaWidth: 1000 }), 80);
});

test('width is held between a readable minimum and the full picture', () => {
    assert.equal(widthPctFrom({ pointerX: 505, centreX: 500, areaWidth: 1000 }), MIN_WIDTH_PCT);
    assert.equal(widthPctFrom({ pointerX: 5000, centreX: 500, areaWidth: 1000 }), MAX_WIDTH_PCT);
});

test('a picture with no measured width does not divide by zero', () => {
    assert.equal(widthPctFrom({ pointerX: 900, centreX: 500, areaWidth: 0 }), MAX_WIDTH_PCT);
});


// A corner scales the subtitle as one object. Dragging it out doubles the
// box AND the text, so the background grows with the words instead of the
// text swelling inside a box that stayed put.
test('a corner scales box and text by the same amount', () => {
    const r = scaleFrom({
        pointerX: 900, centreX: 500, startHalfWidth: 200,
        startWidthPct: 40, startFont: 20
    });
    assert.deepEqual(r, { widthPct: 80, fontSize: 40 });   // ratio 2
});

test('dragging a corner inward shrinks both', () => {
    const r = scaleFrom({
        pointerX: 600, centreX: 500, startHalfWidth: 200,
        startWidthPct: 40, startFont: 20
    });
    assert.deepEqual(r, { widthPct: 20, fontSize: 10 });   // ratio 0.5
});

test('grabbing a corner and not moving changes nothing', () => {
    const r = scaleFrom({
        pointerX: 700, centreX: 500, startHalfWidth: 200,
        startWidthPct: 81, startFont: 36
    });
    assert.deepEqual(r, { widthPct: 81, fontSize: 36 });
});

// The point of clamping the ratio rather than each value: once width hits
// 100% the text must stop growing too, or it spills out of its own box.
test('proportions hold at the limits instead of one running on', () => {
    const big = scaleFrom({
        pointerX: 9999, centreX: 500, startHalfWidth: 200,
        startWidthPct: 50, startFont: 20
    });
    assert.equal(big.widthPct, MAX_WIDTH_PCT);
    assert.equal(big.fontSize, 20 * (MAX_WIDTH_PCT / 50));   // same ratio, not MAX_FONT

    // Here the font is the binding constraint, so width must stop early.
    const fontBound = scaleFrom({
        pointerX: 9999, centreX: 500, startHalfWidth: 200,
        startWidthPct: 30, startFont: 60
    });
    assert.equal(fontBound.fontSize, MAX_FONT);
    assert.equal(fontBound.widthPct, Math.round(30 * (MAX_FONT / 60)));
    assert.ok(fontBound.widthPct < MAX_WIDTH_PCT);
});

test('a corner dragged onto the centre line does not collapse to zero', () => {
    const r = scaleFrom({
        pointerX: 500, centreX: 500, startHalfWidth: 200,
        startWidthPct: 80, startFont: 36
    });
    assert.ok(r.widthPct >= MIN_WIDTH_PCT);
    assert.ok(r.fontSize >= MIN_FONT);
});
