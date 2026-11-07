import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parallelMap, STOP } = require('../../electron/parallel-map.cjs');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

test('results keep the order of the input, not of completion', async () => {
    const out = await parallelMap([30, 5, 20, 1], 4, async (ms, i) => {
        await wait(ms);
        return `${i}:${ms}`;
    });
    assert.deepEqual(out, ['0:30', '1:5', '2:20', '3:1']);
});

test('no more than the limit run at once', async () => {
    let inFlight = 0;
    let peak = 0;
    await parallelMap(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await wait(5);
        inFlight -= 1;
        return null;
    });
    assert.ok(peak <= 4, `peak was ${peak}`);
    assert.ok(peak > 1, 'nothing ran in parallel at all');
});

test('every item is handled exactly once', async () => {
    const seen = [];
    await parallelMap(Array.from({ length: 50 }, (_, i) => i), 7, async (n) => {
        await wait(1);
        seen.push(n);
        return n;
    });
    assert.equal(seen.length, 50);
    assert.equal(new Set(seen).size, 50);
});

test('a stop drains the remaining lanes instead of abandoning them', async () => {
    let started = 0;
    await parallelMap(Array.from({ length: 40 }, (_, i) => i), 4, async (n) => {
        started += 1;
        await wait(1);
        return n === 5 ? STOP : n;
    });
    // Work already dispatched finishes, but it does not run all forty.
    assert.ok(started < 40, `started ${started} of 40`);
});

test('a limit wider than the work does not spin up idle lanes', async () => {
    let started = 0;
    const out = await parallelMap([1, 2], 16, async (n) => { started += 1; return n; });
    assert.equal(started, 2);
    assert.deepEqual(out, [1, 2]);
});

test('an empty list is not an error', async () => {
    assert.deepEqual(await parallelMap([], 4, async () => 1), []);
});
