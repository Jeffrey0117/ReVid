import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseEpisodes, cleanWikitext, episodeFromName } = require('../../electron/wiki-episodes.cjs');

// Shaped like the real article, including the noise that actually appears.
const WIKITEXT = `
{{Episode list/sublist|Brooklyn Nine-Nine season 2
| EpisodeNumber = 23
| EpisodeNumber2 = 1
| Title = [[Undercover (Brooklyn Nine-Nine)|Undercover]]
| DirectedBy = [[Dean Holland]]
| OriginalAirDate = {{Start date|2014|9|28}}
| Viewers = 5.46<ref>{{cite web|url=http://example.com|title=Ratings}}</ref>
| ShortSummary = Jake makes a triumphant return from the FBI, but one target had escaped.<ref name="x"/>
| LineColor = 3A3533
}}
{{Episode list/sublist|Brooklyn Nine-Nine season 2
| EpisodeNumber = 24
| EpisodeNumber2 = 2
| Title = Chocolate Milk
| OriginalAirDate = {{Start date|2014|10|5}}
| ShortSummary = Terry's hiding something, and Amy's determined to find out what it is.
| LineColor = 3A3533
}}
`;

test('wiki links keep their visible text', () => {
    assert.equal(cleanWikitext('[[Dean Holland]]'), 'Dean Holland');
    assert.equal(cleanWikitext('[[Undercover (Brooklyn Nine-Nine)|Undercover]]'), 'Undercover');
});

test('references and templates are dropped, not shown as markup', () => {
    assert.equal(cleanWikitext('Ratings<ref>{{cite web|url=x}}</ref> rose'), 'Ratings rose');
    assert.equal(cleanWikitext('Done<ref name="y"/>'), 'Done');
    assert.ok(!cleanWikitext("It's {{'}}fine{{'}}").includes('{{'));
});

test('bold and italic markup is removed', () => {
    assert.equal(cleanWikitext("'''Bold''' and ''italic''"), 'Bold and italic');
});

test('episodes come back numbered, titled and summarised', () => {
    const eps = parseEpisodes(WIKITEXT);
    assert.equal(eps.length, 2);

    assert.equal(eps[0].episode, 1);
    assert.equal(eps[0].title, 'Undercover');
    assert.ok(eps[0].summary.startsWith('Jake makes a triumphant return'));
    // The trailing ref must not survive into the summary.
    assert.ok(!eps[0].summary.includes('<ref'));

    assert.equal(eps[1].episode, 2);
    assert.equal(eps[1].title, 'Chocolate Milk');
});

test('a summary stops at the next field rather than swallowing it', () => {
    const eps = parseEpisodes(WIKITEXT);
    assert.ok(!eps[0].summary.includes('LineColor'));
    assert.ok(!eps[1].summary.includes('LineColor'));
});

// Regression: a field whose value is itself a template ({{Start date|...}})
// was cut at the inner closing braces, leaving "{{Start date|2014|9|28" —
// unbalanced, so the markup stripper could not remove it either.
test('a field holding a template is read whole, not cut at its inner braces', () => {
    const [ep] = parseEpisodes(WIKITEXT);
    assert.ok(!ep.airDate.includes('{{'), `airDate kept markup: ${ep.airDate}`);
    assert.ok(!ep.airDate.includes('}}'), `airDate kept markup: ${ep.airDate}`);
    // Stripping the template must not throw the date away with it.
    assert.equal(ep.airDate, '2014-09-28');
});

test('a date template becomes a readable date', () => {
    assert.equal(cleanWikitext('{{Start date|2014|10|5}}'), '2014-10-05');
    assert.equal(cleanWikitext('Aired {{Start date|2015|1|4|df=y}} on Fox'), 'Aired 2015-01-04 on Fox');
});

// A two-part episode that aired as one hour is written as a single block
// with numbered variants of each field. Reading only EpisodeNumber2 left a
// hole in the season, so those files matched nothing.
const TWO_PARTER = `
{{Episode list/sublist|Show season 4
| NumParts = 2
| EpisodeNumber_1 = 79
| EpisodeNumber_2 = 80
| EpisodeNumber2_1 = 11
| EpisodeNumber2_2 = 12
| Title = [[The Fugitive (Show)|The Fugitive]]
| OriginalAirDate = {{Start date|2017|01|01}}
| ShortSummary = The squad goes on a manhunt for nine escaped convicts.
| LineColor = 0F0E0E
}}
`;

test('both halves of a two-part episode are returned', () => {
    const eps = parseEpisodes(TWO_PARTER);
    assert.deepEqual(eps.map(e => e.episode), [11, 12]);
    // They share the hour, so they share what it was about.
    assert.ok(eps.every(e => e.title === 'The Fugitive'));
    assert.ok(eps.every(e => e.summary.includes('escaped convicts')));
});

test('a two-parter is marked so the UI can say it is one hour', () => {
    assert.ok(parseEpisodes(TWO_PARTER).every(e => e.parts === 2));
    assert.ok(parseEpisodes(WIKITEXT).every(e => !e.parts || e.parts === 1));
});

test('an article with no episode templates yields nothing, not a crash', () => {
    assert.deepEqual(parseEpisodes('{{Infobox television season}}\nSome prose.'), []);
    assert.deepEqual(parseEpisodes(''), []);
    assert.deepEqual(parseEpisodes(null), []);
});

test('season and episode are read from the usual filename shapes', () => {
    assert.deepEqual(episodeFromName('神烦警探 S02E01 「第01集」卧底.mp4'), { season: 2, episode: 1 });
    assert.deepEqual(episodeFromName('Show.s03e12.1080p.mkv'), { season: 3, episode: 12 });
    assert.deepEqual(episodeFromName('Show 2x05.mp4'), { season: 2, episode: 5 });
    assert.deepEqual(episodeFromName('Show S2E7.mp4'), { season: 2, episode: 7 });
});

test('a filename with no episode marking is left alone', () => {
    for (const name of ['holiday clip.mp4', 'IMG_2024.mov', '']) {
        assert.equal(episodeFromName(name), null);
    }
});

test('the Chinese episode counter does not get mistaken for the number', () => {
    // 「第01集」 contains digits too; S02E09 is the authority.
    assert.deepEqual(episodeFromName('神烦警探 S02E09 「第09集」糖果.mp4'), { season: 2, episode: 9 });
    assert.deepEqual(episodeFromName('神烦警探 S02E18 「第18集」.mp4'), { season: 2, episode: 18 });
});
