import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { render } = require('../../electron/lan-page.cjs');

const page = render('a-test-token');

test('the page is built for a phone, not shrunk from a desktop', () => {
    assert.match(page, /<meta name="viewport"[^>]*width=device-width/);
    assert.match(page, /viewport-fit=cover/);
});

// The reported bug: a landscape video on a portrait phone leaves most of
// the screen black, and subtitles anchored to the screen floated in that
// black, far from the picture, wrapped to eight lines.
test('subtitles live inside the picture, not on the screen', () => {
    assert.match(page, /id="stage"/);
    assert.ok(page.indexOf('id="stage"') < page.indexOf('id="cc"'),
        'the subtitle layer must be inside the stage');
    assert.match(page, /#stage\s*\{[^}]*position:\s*relative/);
});

test('the stage takes the shape of the video it is showing', () => {
    assert.match(page, /function fitStage/);
    assert.match(page, /aspectRatio/);
    assert.match(page, /loadedmetadata['"],\s*fitStage/);
    // And follows the phone being turned over.
    assert.match(page, /orientationchange/);
});

// The reported bug: a ninety-character cue rendered as four lines of
// English stacked on four of Chinese, covering the picture. Shrinking the
// type was the wrong answer; the cue is shown in pieces instead.
test('a long cue is shown in pieces rather than all at once', () => {
    assert.match(page, /function chunkText/);
    assert.match(page, /function visibleCue/);
    assert.match(page, /MAX_LINES\s*=\s*2/);
    // Driven by how far through the cue playback is.
    assert.match(page, /progress/);
});

test('the block still cannot outgrow the room it has', () => {
    assert.match(page, /maxHeight/);
});

test('it does not redraw identical text four times a second', () => {
    assert.match(page, /lastDrawn/);
});

test('it moves into the black below the video when there is room', () => {
    assert.match(page, /classList\.add\('below'\)/);
    assert.match(page, /#cc\.below/);
    // And back over the picture when the video fills the screen.
    assert.match(page, /classList\.remove\('below'\)/);
});

test('subtitle size follows the screen width rather than a fixed count', () => {
    assert.match(page, /window\.innerWidth\s*\*/);
    assert.match(page, /function fitSize|const fitSize/);
});

test('controls use drawn icons, not whatever emoji the phone ships', () => {
    assert.match(page, /id="gear"[^>]*>\s*<svg/);
    assert.doesNotMatch(page, /[\u{1F300}-\u{1FAFF}]/u);
    assert.doesNotMatch(page, /⚙/); // the gear emoji specifically
});

test('every interactive control is big enough for a thumb', () => {
    assert.match(page, /min-width:\s*44px/);
    assert.match(page, /min-height:\s*40px/);
});

test('the token reaches the page so its own requests are authorised', () => {
    assert.ok(page.includes('a-test-token'));
});

test('a different token produces a different page', () => {
    assert.notEqual(render('another-token'), page);
});
