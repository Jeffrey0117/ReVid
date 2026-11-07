import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    cleanWikitext, seasonTitles, apiHost, parseEpisodes, parseShow, infoboxFieldRaw
} = require('../../electron/wiki-episodes.cjs');

// zh.wikipedia writes both script variants inline and lets the reader's
// setting pick. Left alone it lands on screen as literal markup.
test('a traditional/simplified variant resolves to one readable title', () => {
    assert.equal(cleanWikitext('-{zh-hant:巧克力牛奶;zh-hans:巧克力奶;}-'), '巧克力牛奶');
    assert.equal(cleanWikitext('-{zh-hans:比赛插曲;zh-hant:吉米·傑柏遊戲;}-'), '吉米·傑柏遊戲');
    // A plain -{...}- just protects text from conversion; keep the text.
    assert.equal(cleanWikitext('-{Brooklyn}-'), 'Brooklyn');
});

test('an episode title keeps no conversion markup', () => {
    const zh = `
{{Episode list/sublist|X
| EpisodeNumber2 = 2
| Title = -{zh-hant:巧克力牛奶;zh-hans:巧克力奶;}-
| ShortSummary = 傑克陪伴泰瑞。
}}
`;
    assert.equal(parseEpisodes(zh)[0].title, '巧克力牛奶');
});

test('the image field keeps its filename instead of its display size', () => {
    // zh writes a whole file link; cleaning it as a piped link left "270px".
    const art = '{{Infobox television\n| image = [[File:Logo.png|270px]]\n| genre = 情境喜劇\n}}';
    assert.ok(infoboxFieldRaw(art, 'image').includes('Logo.png'));
});

test('a lead that does not start with bold still yields a description', () => {
    const zh = `{{Infobox television
| show_name = 荒唐分局
}}
'''《荒唐分局》'''（{{lang-en|Brooklyn Nine-Nine}}）是一部美國情境喜劇。
`;
    const show = parseShow(zh);
    assert.ok(show.description.includes('美國情境喜劇'), show.description);
    assert.ok(!/\{\{|\[\[|'''/.test(show.description), show.description);
});

test('a cross-language link keeps the name in the language being read', () => {
    // {{link-en|中文|English}} is how zh.wikipedia names someone who has no
    // Chinese article. Stripping it as a template lost the name entirely.
    assert.equal(cleanWikitext('{{link-en|丹·戈尔|Dan Goor}}'), '丹·戈尔');
    assert.equal(
        cleanWikitext('{{link-en|迪恩·霍蘭德|Dean Holland}}、{{link-en|邁克爾·舒爾|Michael Schur}}'),
        '迪恩·霍蘭德、邁克爾·舒爾'
    );
});

// zh.wikipedia mostly uses the {{le|...}} shorthand rather than the long
// form, so handling only link-en dropped every name in the lead: "是一部由
// 與 共同製作的" with both creators missing.
test('the shorthand for a cross-language link keeps its name too', () => {
    assert.equal(cleanWikitext('{{le|丹·戈爾|Dan Goor}}'), '丹·戈爾');
    assert.equal(
        cleanWikitext('由{{le|丹·戈爾|Dan Goor}}與{{tsl|en|Michael Schur|邁克爾·舒爾}}共同製作'),
        '由丹·戈爾與邁克爾·舒爾共同製作'
    );
});

// Every spelling of the original-title wrapper, because dropping it leaves
// "《荒唐分局》（）" — an empty bracket in the middle of the description.
test('the original title survives whichever language template wraps it', () => {
    for (const markup of [
        "{{lang|en|''Brooklyn Nine-Nine''}}",
        "{{langx|en|''Brooklyn Nine-Nine''}}",
        '{{lang-en|Brooklyn Nine-Nine}}'
    ]) {
        assert.equal(cleanWikitext(markup), 'Brooklyn Nine-Nine', markup);
    }
});

test('English articles are unaffected by that handling', () => {
    assert.equal(cleanWikitext('[[Dean Holland]]'), 'Dean Holland');
    assert.equal(cleanWikitext("'''Bold'''"), 'Bold');
});

test('each language asks its own Wikipedia', () => {
    assert.ok(apiHost('en').includes('en.wikipedia.org'));
    assert.ok(apiHost('zh').includes('zh.wikipedia.org'));
    assert.ok(apiHost(undefined).includes('en.wikipedia.org'));
});

test('season articles are named the way each language names them', () => {
    assert.deepEqual(seasonTitles('Brooklyn Nine-Nine', 2, 'en'),
        ['Brooklyn Nine-Nine season 2']);
    // zh uses Chinese numerals in parentheses.
    assert.ok(seasonTitles('荒唐分局', 2, 'zh').includes('荒唐分局 (第二季)'));
    assert.ok(seasonTitles('荒唐分局', 8, 'zh').includes('荒唐分局 (第八季)'));
});

test('a double-digit season still gets a name to try', () => {
    const titles = seasonTitles('某劇', 12, 'zh');
    assert.ok(titles.length > 0);
    assert.ok(titles.every(t => typeof t === 'string' && t.length > 0));
});

test('Chinese episode blocks parse the same as English ones', () => {
    const zh = `
{{Episode list/sublist|荒唐分局 (第二季)
| EpisodeNumber   = 23
| EpisodeNumber2  = 1
| Title           = 臥底
| AltTitle        = Undercover
| DirectedBy      = {{link-en|迪恩·霍蘭德|Dean Holland}}
| OriginalAirDate = {{Start date|2014|9|28}}
| ShortSummary    = 傑克結束臥底任務後凱旋回歸,然而他卻發現其中一名嫌犯落跑。
}}
`;
    const [ep] = parseEpisodes(zh);
    assert.equal(ep.episode, 1);
    assert.equal(ep.title, '臥底');
    assert.ok(ep.summary.startsWith('傑克結束臥底任務'));
    assert.equal(ep.airDate, '2014-09-28');
});
