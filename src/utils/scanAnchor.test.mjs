import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAnchor } = require('../../electron/scan-anchor.cjs');

test('it admits it does not know yet', () => {
    const a = createAnchor();
    assert.equal(a.get(), null);
    a.record(1290);
    assert.equal(a.get(), null, 'one hit is not a pattern');
    a.record(1295);
    assert.equal(typeof a.get(), 'number');
});

test('it settles on the middle of recent hits, not an average', () => {
    const a = createAnchor();
    // One wild hit should not drag the guess with it.
    for (const v of [1290, 1295, 1292, 20, 1294]) a.record(v);
    const anchor = a.get();
    assert.ok(anchor > 1280 && anchor < 1300, `anchor was ${anchor}`);
});

// The real failure: a whole-show scan anchored on season one and then
// decoded all seven other seasons in full, having guessed wrong every time.
test('it follows the scan into a season that sits elsewhere', () => {
    const a = createAnchor();
    for (const v of [1290, 1292, 1295]) a.record(v);
    assert.ok(Math.abs(a.get() - 1292) < 5);

    // New season: the window misses, then full scans find it somewhere new.
    a.miss();
    a.record(1100);
    a.miss();
    a.record(1104);
    a.record(1102);
    assert.ok(Math.abs(a.get() - 1102) < 10, `still stuck at ${a.get()}`);
});

test('a run of misses gives up the guess rather than insisting', () => {
    const a = createAnchor();
    for (const v of [1290, 1292, 1295]) a.record(v);
    for (let i = 0; i < 5; i++) a.miss();
    assert.equal(a.get(), null);
});

test('it only ever remembers a few, so old seasons cannot outvote the current one', () => {
    const a = createAnchor({ window: 5 });
    for (let i = 0; i < 50; i++) a.record(1290);
    assert.equal(a.size(), 5);
    for (let i = 0; i < 5; i++) a.record(600);
    assert.ok(Math.abs(a.get() - 600) < 1, `anchor was ${a.get()}`);
});

test('nonsense is ignored rather than poisoning the guess', () => {
    const a = createAnchor();
    a.record(NaN);
    a.record(undefined);
    a.record(Infinity);
    assert.equal(a.get(), null);
    assert.equal(a.size(), 0);
});
