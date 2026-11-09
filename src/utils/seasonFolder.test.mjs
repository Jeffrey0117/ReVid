import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { looksLikeSeason } = require('../../electron/season-folder.cjs');

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
