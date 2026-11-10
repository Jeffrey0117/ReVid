import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { looksLikeSeason, shareRootFor } = require('../../electron/season-folder.cjs');

test('the shapes this library actually uses', () => {
    for (const name of ['s1', 's5', 's01', 'S8', 's 2']) {
        assert.equal(looksLikeSeason(name), true, name);
    }
});

test('common English season folders', () => {
    for (const name of ['Season 1', 'season2', 'Season-10', 'SEASON_3']) {
        assert.equal(looksLikeSeason(name), true, name);
    }
});

test('Chinese season folders', () => {
    for (const name of ['第1季', '第五季', '第十二季']) {
        assert.equal(looksLikeSeason(name), true, name);
    }
});

// The whole point: these are the names that turned a sibling sweep into a
// sweep of the home directory.
test('ordinary folders are not seasons', () => {
    for (const name of ['Downloads', 'Videos', 'Desktop', 'Documents',
                        'Music', 'Pictures', '荒唐分局', 'course-01', 'temp']) {
        assert.equal(looksLikeSeason(name), false, name);
    }
});

test('a number alone is not a season', () => {
    // A folder called "5" is as likely to be a chapter, a year, or a dump.
    assert.equal(looksLikeSeason('5'), false);
    assert.equal(looksLikeSeason('2024'), false);
});

test('nothing in, false out', () => {
    assert.equal(looksLikeSeason(''), false);
    assert.equal(looksLikeSeason('   '), false);
    assert.equal(looksLikeSeason(null), false);
    assert.equal(looksLikeSeason(undefined), false);
    assert.equal(looksLikeSeason(42), false);
});

// --- what a network share hands out ---

// String.raw throughout: a Windows path written as a normal string turns
// \U and \A into escapes, and the test then asserts against a mangled path
// that has nothing to do with what the code sees.
test('opening one season shares the show, so the others are reachable', () => {
    assert.equal(
        shareRootFor(String.raw`C:\Users\AUSER\Videos\荒唐分局\s2`),
        String.raw`C:\Users\AUSER\Videos\荒唐分局`
    );
});

// Widening the root is only safe because it is one known level. An ordinary
// folder stays exactly as shared as it was.
test('an ordinary folder shares only itself', () => {
    for (const p of [String.raw`C:\Users\AUSER\Videos`, String.raw`C:\Users\AUSER\Downloads`]) {
        assert.equal(shareRootFor(p), p);
    }
});

// A folder called "s1" at the top of a disk must not share the disk.
test('it never climbs into a drive root', () => {
    assert.equal(shareRootFor(String.raw`C:\s1`), String.raw`C:\s1`);
    assert.equal(shareRootFor('/s1'), '/s1');
});

test('nothing in, nothing thrown', () => {
    assert.equal(shareRootFor(''), '');
    assert.equal(shareRootFor(null), null);
    assert.equal(shareRootFor(undefined), undefined);
});
