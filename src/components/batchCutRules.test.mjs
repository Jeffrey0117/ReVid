import test from 'node:test';
import assert from 'node:assert/strict';
import { canToggleRow, pendingRows, missedRows } from './batchCutRules.js';

const nothingToCut = (r) => Boolean(r.nothing);

// What the folder looked like after the reported run: twenty cut, three
// found at a score below the auto-tick threshold and never ticked.
const afterRun = [
    { path: 'E01', status: 'done', selected: true },
    { path: 'E06', status: 'found', score: 0.82, selected: false },
    { path: 'E08', status: 'found', score: 0.80, selected: false },
    { path: 'E09', status: 'found', score: 0.79, selected: false },
    { path: 'E10', status: 'done', selected: true },
    { path: 'E20', status: 'failed', selected: true },
    { path: 'E21', status: 'notfound', selected: false },
    { path: 'E22', status: 'found', nothing: true, selected: false }
];

// Regression: once the run finished nothing could be ticked, so three
// episodes were stranded and the only way back was rescanning the folder.
test('a missed row can still be ticked after the run finishes', () => {
    const missed = afterRun.find(r => r.path === 'E06');
    assert.equal(canToggleRow('done', missed, nothingToCut), true);
});

test('rows that are finished or hopeless stay untickable', () => {
    for (const path of ['E01', 'E20', 'E21', 'E22']) {
        const row = afterRun.find(r => r.path === path);
        assert.equal(canToggleRow('done', row, nothingToCut), false, path);
    }
});

// A season that was already trimmed has nothing left to find, so the
// matcher latches onto whatever is near the end: twenty episodes of
// season three were cut a second time and lost three seconds each.
test('a file already cut cannot be cut again', () => {
    const row = { path: 'E30', status: 'alreadycut', selected: false };
    for (const phase of ['review', 'done', 'scanning', 'cutting']) {
        assert.equal(canToggleRow(phase, row, nothingToCut), false, phase);
    }
    assert.deepEqual(pendingRows([{ ...row, selected: true }], nothingToCut), []);
});

test('nothing is tickable while the work is actually running', () => {
    const row = afterRun.find(r => r.path === 'E06');
    assert.equal(canToggleRow('scanning', row, nothingToCut), false);
    assert.equal(canToggleRow('cutting', row, nothingToCut), false);
});

test('every row is tickable before a scan starts', () => {
    for (const row of afterRun) {
        assert.equal(canToggleRow('setup', row, nothingToCut), true, row.path);
    }
});

test('review and done agree, so the rule does not change underfoot', () => {
    for (const row of afterRun) {
        assert.equal(
            canToggleRow('review', row, nothingToCut),
            canToggleRow('done', row, nothingToCut),
            row.path
        );
    }
});

test('the three stranded episodes are reported as missed', () => {
    assert.deepEqual(missedRows(afterRun, nothingToCut).map(r => r.path), ['E06', 'E08', 'E09']);
});

test('a second pass acts only on what was ticked', () => {
    assert.deepEqual(pendingRows(afterRun, nothingToCut), []);
    const ticked = afterRun.map(r => (r.path === 'E08' ? { ...r, selected: true } : r));
    assert.deepEqual(pendingRows(ticked, nothingToCut).map(r => r.path), ['E08']);
});

test('empty input is not an error', () => {
    assert.deepEqual(missedRows(null, nothingToCut), []);
    assert.deepEqual(pendingRows(undefined, nothingToCut), []);
    assert.equal(canToggleRow('done', null, nothingToCut), false);
});
