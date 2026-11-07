import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseShow, infoboxField, listItems } = require('../../electron/wiki-episodes.cjs');

// Trimmed from the real article, keeping every shape that broke a simpler
// parser: nested multi-line templates, piped links, <br>, inline refs.
const ARTICLE = `
{{Short description|American sitcom}}
{{Infobox television
| image                = Logo.png
| genre                = {{Plainlist|
* [[Workplace comedy]]
* [[Sitcom]]
* [[Police procedural]]
}}
| creator              = {{Plainlist|
* [[Dan Goor]]
* [[Michael Schur]]
}}
| starring             = {{Plainlist|
* [[Andy Samberg]]
* [[Stephanie Beatriz]]
}}
| theme_music_composer = Dan Marocco<br>featuring {{Unbulleted list|Jacques Slade|Lamar Van Sciver}}
| country              = United States
| num_seasons          = 8
| num_episodes         = 153
}}

'''''Brooklyn Nine-Nine''''' is an American [[police procedural]] [[sitcom]] that aired on [[Fox Broadcasting Company|Fox]] from September 17, 2013, to May 20, 2018. It revolved around seven detectives.
`;

test('a field whose value is a multi-line template is read whole', () => {
    const genre = infoboxField(ARTICLE, 'genre');
    assert.ok(genre.includes('Workplace comedy'), genre);
    assert.ok(genre.includes('Police procedural'), genre);
});

test('a field stops at the next field rather than swallowing it', () => {
    assert.ok(!infoboxField(ARTICLE, 'genre').includes('creator'));
    assert.ok(!infoboxField(ARTICLE, 'creator').includes('starring'));
    assert.equal(infoboxField(ARTICLE, 'country'), 'United States');
});

test('a plain list becomes the names it holds', () => {
    assert.deepEqual(listItems(infoboxField(ARTICLE, 'creator')), ['Dan Goor', 'Michael Schur']);
    assert.deepEqual(listItems(infoboxField(ARTICLE, 'genre')),
        ['Workplace comedy', 'Sitcom', 'Police procedural']);
});

test('a missing field is empty rather than undefined', () => {
    assert.equal(infoboxField(ARTICLE, 'nonexistent'), '');
    assert.deepEqual(listItems(''), []);
});

test('the show comes back with everything the header shows', () => {
    const show = parseShow(ARTICLE);
    assert.equal(show.seasons, 8);
    assert.equal(show.episodes, 153);
    assert.deepEqual(show.creators, ['Dan Goor', 'Michael Schur']);
    assert.deepEqual(show.starring, ['Andy Samberg', 'Stephanie Beatriz']);
    assert.ok(show.genre.includes('Sitcom'));
});

test('the description is readable prose, not markup', () => {
    const { description } = parseShow(ARTICLE);
    assert.ok(description.startsWith('Brooklyn Nine-Nine is an American'), description);
    assert.ok(!/\[\[|'''|\{\{/.test(description), description);
    // A piped link keeps the text a reader would see, not the article name.
    assert.ok(description.includes('aired on Fox'), description);
});

test('the years it ran are picked out of the lead', () => {
    assert.equal(parseShow(ARTICLE).year, 2013);
});

test('an article with no infobox does not throw', () => {
    const show = parseShow('Just some prose with no template at all.');
    assert.equal(show.seasons, null);
    assert.deepEqual(show.creators, []);
});
