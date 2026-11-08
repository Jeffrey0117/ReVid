import test from 'node:test';
import assert from 'node:assert/strict';
import { ccPlacement, blockHeight, fitFontSize, MIN_SIZE } from './ccFit.js';

// A 390x844 phone held upright, showing a 16:9 episode: the video is about
// 219px tall and over 600px of the screen is black.
const PHONE = { screenHeight: 844, videoHeight: 219 };

test('on a portrait phone the subtitle goes in the empty space, not on the picture', () => {
    const p = ccPlacement(PHONE);
    assert.equal(p.mode, 'below');
    assert.ok(p.allowance > 250, `only ${p.allowance}px of room found`);
});

test('when the video fills the screen the subtitle overlays it', () => {
    const p = ccPlacement({ screenHeight: 390, videoHeight: 390 });
    assert.equal(p.mode, 'over');
    // And is never allowed to swallow the picture.
    assert.ok(p.allowance < 390 * 0.4);
});

// The reported bug: turning the size up made the block taller until it
// covered everything.
test('a long line at a large size is shrunk to fit rather than growing', () => {
    const { allowance } = ccPlacement({ screenHeight: 390, videoHeight: 390 });
    const chars = 120; // a full line of English dialogue
    const fitted = fitFontSize({ wanted: 34, chars, widthPx: 366, allowance });
    assert.ok(fitted < 34, 'nothing was shrunk');
    const h = blockHeight({
        chars, charsPerLine: Math.floor(366 / (fitted * 0.62)), fontSize: fitted
    });
    assert.ok(h <= allowance, `${h}px still exceeds ${allowance}px`);
});

test('a short line keeps the size that was asked for', () => {
    const { allowance } = ccPlacement(PHONE);
    assert.equal(fitFontSize({ wanted: 20, chars: 18, widthPx: 374, allowance }), 20);
});

test('the block never exceeds its allowance, whatever is thrown at it', () => {
    for (const chars of [20, 80, 200, 600]) {
        for (const wanted of [12, 20, 28, 34]) {
            for (const place of [PHONE, { screenHeight: 390, videoHeight: 390 }]) {
                const { allowance } = ccPlacement(place);
                const size = fitFontSize({ wanted, chars, widthPx: 366, allowance });
                const h = blockHeight({
                    chars, charsPerLine: Math.floor(366 / (size * 0.62)), fontSize: size
                });
                // At the floor the block is allowed to scroll instead of
                // shrinking into illegibility.
                assert.ok(h <= allowance || size === MIN_SIZE,
                    `${chars} chars at ${wanted}px -> ${size}px, ${h}px vs ${allowance}px`);
            }
        }
    }
});

test('it never shrinks text into unreadability', () => {
    const size = fitFontSize({ wanted: 34, chars: 5000, widthPx: 300, allowance: 40 });
    assert.equal(size, MIN_SIZE);
});

test('an empty subtitle takes no height', () => {
    assert.equal(blockHeight({ chars: 0, charsPerLine: 20, fontSize: 20 }), 0);
});

test('a wider screen fits the same words at a larger size', () => {
    const { allowance } = ccPlacement({ screenHeight: 390, videoHeight: 390 });
    const narrow = fitFontSize({ wanted: 30, chars: 120, widthPx: 360, allowance });
    const wide = fitFontSize({ wanted: 30, chars: 120, widthPx: 900, allowance });
    assert.ok(wide >= narrow, `${wide} should not be smaller than ${narrow}`);
});
