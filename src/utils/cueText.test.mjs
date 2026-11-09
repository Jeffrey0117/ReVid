import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cleanCueText } = require('../../electron/cue-text.cjs');

test('the speaker marker goes, the words stay', () => {
    assert.equal(cleanCueText('>> Sorry Sarge, Halloween is the worst.'),
        'Sorry Sarge, Halloween is the worst.');
    assert.equal(cleanCueText('>>Oh, so you don\'t have all the answers.'),
        'Oh, so you don\'t have all the answers.');
});

// A long cue can hold two speakers. Dropping the marker outright would run
// "...answers.Right" together into one word.
test('a marker between two speakers becomes a space', () => {
    assert.equal(cleanCueText('No way. >> Yes way.'), 'No way. Yes way.');
    assert.equal(cleanCueText('No way.>>Yes way.'), 'No way. Yes way.');
});

test('a cue that is only a marker comes back empty', () => {
    assert.equal(cleanCueText('>>'), '');
    assert.equal(cleanCueText('  >>  '), '');
});

test('ordinary text is returned untouched, not reformatted', () => {
    // No trim, no whitespace collapsing: this runs over every cue of every
    // episode, and rewriting text that has no marker in it is all risk and
    // no benefit.
    const plain = '  Spaced  out   text.  ';
    assert.equal(cleanCueText(plain), plain);
    assert.equal(cleanCueText('5 > 3 and 3 < 5'), '5 > 3 and 3 < 5');
});

test('markers left alone stay alone', () => {
    // Each of these was counted and deliberately kept; a change here should
    // be a decision, not a side effect.
    assert.equal(cleanCueText('- I\'m so glad we could do this.'),
        '- I\'m so glad we could do this.');
    assert.equal(cleanCueText('[singing]'), '[singing]');
    assert.equal(cleanCueText('(scatting)'), '(scatting)');
    assert.equal(cleanCueText('♪ Consider yourself ♪'), '♪ Consider yourself ♪');
});

test('nothing in, nothing thrown', () => {
    assert.equal(cleanCueText(''), '');
    assert.equal(cleanCueText(null), null);
    assert.equal(cleanCueText(undefined), undefined);
    assert.equal(cleanCueText(42), 42);
});
