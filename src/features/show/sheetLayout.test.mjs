import test from 'node:test';
import assert from 'node:assert/strict';
import { SHEET, headerHeight, visibleRows } from './sheetLayout.js';

// The reported bug: "第 1 集 Pilot" has a long synopsis and showed two
// episodes; "第 4 集 M.E. Time" has a short one and showed five.
const LONG = 8;   // lines of synopsis
const SHORT = 3;

test('a long synopsis no longer pushes the episode list away', () => {
    const tall = headerHeight({ summaryLines: LONG });
    const short = headerHeight({ summaryLines: SHORT });
    // Capped, so the difference between a wordy and a terse episode is at
    // most the couple of lines before the cap, not the whole paragraph.
    assert.ok(tall - short < 60, `header grew by ${tall - short}px`);
});

test('the same card shows a comparable list either way', () => {
    const card = 700;
    const withLong = visibleRows(card, { summaryLines: LONG });
    const withShort = visibleRows(card, { summaryLines: SHORT });
    assert.ok(Math.abs(withLong - withShort) <= 1,
        `${withLong} rows vs ${withShort} rows`);
});

test('the list keeps a usable size even in a short window', () => {
    for (const card of [420, 520, 640, 900]) {
        assert.ok(visibleRows(card, { summaryLines: LONG }) >= 5,
            `only ${visibleRows(card, { summaryLines: LONG })} rows at ${card}px`);
    }
});

test('a synopsis beyond the cap stops adding height at all', () => {
    const atCap = headerHeight({ summaryLines: 6 });
    const wayOver = headerHeight({ summaryLines: 40 });
    assert.equal(atCap, wayOver);
});

test('the bounds are the ones the component uses', () => {
    assert.equal(SHEET.heroMaxPx, 210);
    assert.equal(SHEET.listMinPx, 170);
    assert.ok(SHEET.summaryMaxEm > 0 && SHEET.summaryMaxEm < 20);
});
