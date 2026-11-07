import test from 'node:test';
import assert from 'node:assert/strict';
import { REEL_BASE_STYLE, toReelStyle } from './reelStyle.js';

const player = {
    fontSize: 18, color: '#ffffff', bgOpacity: 0.72, position: 'bottom',
    offset: 76, timeShift: 0, strokeWidth: 0, strokeColor: '#000000', shadow: 0.6
};

test('defaults land on the tuned reel look, not the player values', () => {
    const s = toReelStyle(player);
    assert.equal(s.fontSize, REEL_BASE_STYLE.fontSize);
    assert.equal(s.fontWeight, REEL_BASE_STYLE.fontWeight);
    // No outline in the player still means an outline on the reel: burned
    // text sits over moving footage with no background to rest on.
    assert.ok(s.strokeWidth > 0);
});

test('a bigger subtitle in the player scales the reel proportionally', () => {
    const bigger = toReelStyle({ ...player, fontSize: 36 });
    assert.equal(bigger.fontSize, REEL_BASE_STYLE.fontSize * 2);

    const smaller = toReelStyle({ ...player, fontSize: 9 });
    assert.equal(smaller.fontSize, Math.round(REEL_BASE_STYLE.fontSize * 0.5));
});

test('font size is clamped so an extreme player setting cannot ruin the reel', () => {
    assert.ok(toReelStyle({ ...player, fontSize: 200 }).fontSize <= 200);
    assert.ok(toReelStyle({ ...player, fontSize: 1 }).fontSize >= 40);
});

test('colours chosen in the player carry over', () => {
    const s = toReelStyle({ ...player, color: '#ffe082', strokeColor: '#203040' });
    assert.equal(s.color, '#ffe082');
    assert.equal(s.strokeColor, '#203040');
});

test('an explicit outline is honoured rather than replaced', () => {
    const s = toReelStyle({ ...player, strokeWidth: 4 });
    assert.ok(s.strokeWidth > REEL_BASE_STYLE.strokeWidth);
});

test('top placement is respected by lifting the line off the bottom', () => {
    const bottom = toReelStyle({ ...player, position: 'bottom' });
    const top = toReelStyle({ ...player, position: 'top' });
    assert.ok(top.bottomPct > bottom.bottomPct);
});

test('a missing or partial style still produces a complete one', () => {
    for (const input of [undefined, {}, { color: '#abcdef' }]) {
        const s = toReelStyle(input);
        for (const key of Object.keys(REEL_BASE_STYLE)) {
            assert.notEqual(s[key], undefined, `${key} missing for ${JSON.stringify(input)}`);
        }
        assert.ok(Number.isFinite(s.fontSize));
    }
});
