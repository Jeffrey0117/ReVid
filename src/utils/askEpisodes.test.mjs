import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildCorpus, parseAnswer, MAX_ANSWERS } = require('../../electron/ask-episodes.cjs');

const entries = [
    { videoPath: 'C:\\V\\s2\\a.mp4', name: 'a.mp4', guide: { episode: 4, title: 'Halloween II', summary: 'Jake and Holt bet again.' } },
    { videoPath: 'C:\\V\\s2\\b.mp4', name: 'b.mp4', guide: { episode: 5, title: 'The Mole', summary: 'Someone is leaking information.' } },
    { videoPath: 'C:\\V\\s3\\c.mp4', name: 'c.mp4', guide: { episode: 1, title: 'New Captain', summary: 'A new boss arrives.' } }
];

test('every episode appears exactly once, tagged by index', () => {
    const corpus = buildCorpus(entries);
    assert.match(corpus, /^0\s*\|/m);
    assert.match(corpus, /^1\s*\|/m);
    assert.match(corpus, /^2\s*\|/m);
    assert.ok(corpus.includes('Halloween II'));
    assert.ok(corpus.includes('leaking information'));
});

test('the corpus carries no absolute paths, which the model has no use for', () => {
    assert.ok(!buildCorpus(entries).includes('C:\\'));
});

test('an index answer maps back to the right files', () => {
    const picked = parseAnswer('[{"i":1,"why":"the leak plot"}]', entries);
    assert.equal(picked.length, 1);
    assert.equal(picked[0].videoPath, 'C:\\V\\s2\\b.mp4');
    assert.equal(picked[0].why, 'the leak plot');
});

test('prose around the JSON is tolerated', () => {
    const picked = parseAnswer('Here you go:\n```json\n[{"i":0,"why":"bet"}]\n```\nHope that helps.', entries);
    assert.equal(picked.length, 1);
    assert.equal(picked[0].videoPath, 'C:\\V\\s2\\a.mp4');
});

test('an empty answer means nothing fit, not an error', () => {
    assert.deepEqual(parseAnswer('[]', entries), []);
});

test('indices the model invented are dropped, not crashed on', () => {
    const picked = parseAnswer('[{"i":99,"why":"x"},{"i":0,"why":"ok"},{"i":-1,"why":"y"}]', entries);
    assert.equal(picked.length, 1);
    assert.equal(picked[0].videoPath, 'C:\\V\\s2\\a.mp4');
});

test('a non-answer yields nothing rather than throwing', () => {
    for (const junk of ['', 'I could not find anything.', null, '{"not":"an array"}']) {
        assert.deepEqual(parseAnswer(junk, entries), []);
    }
});

test('the same episode named twice is only returned once', () => {
    const picked = parseAnswer('[{"i":0,"why":"a"},{"i":0,"why":"b"}]', entries);
    assert.equal(picked.length, 1);
});

test('an over-long answer is capped', () => {
    const many = JSON.stringify(
        Array.from({ length: 50 }, (_, k) => ({ i: k % entries.length, why: 'x' }))
    );
    assert.ok(parseAnswer(many, entries).length <= MAX_ANSWERS);
});
