// Transcripts answer "who said that line". They do not answer "which episode
// was the one at the wedding" — nobody says the title out loud. Wikipedia's
// season articles carry a synopsis per episode, which is exactly that index,
// so the library can hold it alongside the subtitles and be searched together.
const https = require('https');

const UA = 'ReVid/0.7 (local media library; episode synopses)';

// Each language has its own Wikipedia, with its own article names and its own
// synopses — zh carries full Chinese ones, not just translated titles.
function apiHost(lang) {
    return `https://${lang === 'zh' ? 'zh' : 'en'}.wikipedia.org/w/api.php`;
}

const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function cnNumber(n) {
    if (n <= 10) return CN_NUM[n] || String(n);
    if (n < 20) return `十${CN_NUM[n - 10]}`;
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return `${CN_NUM[tens]}十${ones ? CN_NUM[ones] : ''}`;
}

// Article names a season might live under, best guess first.
function seasonTitles(show, season, lang) {
    if (lang === 'zh') {
        return [
            `${show} (第${cnNumber(season)}季)`,
            `${show}(第${cnNumber(season)}季)`,
            `${show} 第${season}季`
        ];
    }
    return [`${show} season ${season}`];
}

// Wikitext markup, reduced to the sentence a person would read.
function cleanWikitext(input) {
    if (typeof input !== 'string') return '';
    let s = input;

    s = s.replace(/<ref[^>]*\/>/gi, '');
    // Refs nest templates, so take the whole element rather than its pieces.
    s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');

    // Dates are a template, so read them before templates are thrown away.
    s = s.replace(
        /\{\{\s*(?:Start|End) date[^}]*?\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})[^}]*\}\}/gi,
        (_m, y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    );

    // zh.wikipedia writes both script variants inline and lets the reader's
    // setting choose: -{zh-hant:繁;zh-hans:简;}-. Nothing downstream does
    // that, so pick traditional and move on. A bare -{text}- only shields
    // text from conversion, so keep what it holds.
    s = s.replace(/-\{([^{}]*)\}-/g, (_m, body) => {
        const variant = /(?:^|;)\s*zh-(?:hant|tw|hk)\s*:\s*([^;]*)/i.exec(body);
        if (variant) return variant[1].trim();
        const first = /(?:^|;)\s*zh[\w-]*\s*:\s*([^;]*)/i.exec(body);
        return first ? first[1].trim() : body;
    });

    // {{link-en|中文|English}} names someone with no article in this
    // language. It has to be unwrapped before the template sweep below, or
    // the sweep takes the name with it. zh mostly writes the {{le|…}}
    // shorthand, which is the same thing.
    s = s.replace(/\{\{\s*(?:link-[a-z]{2}|le)\s*\|\s*([^|}]+)[^}]*\}\}/gi, '$1');
    // {{tsl|lang|Article|中文}} puts the readable name last instead.
    s = s.replace(
        /\{\{\s*tsl\s*\|\s*[a-z-]+\s*\|\s*([^|}]+)(?:\|\s*([^|}]+))?[^}]*\}\}/gi,
        (_m, article, label) => (label || article).trim()
    );
    // {{lang|en|…}}, {{langx|en|…}} and {{lang-en|…}} all wrap the original
    // title, which is worth keeping — losing it leaves an empty bracket.
    s = s.replace(/\{\{\s*langx?\s*\|\s*[a-z-]+\s*\|\s*([^|}]*)[^}]*\}\}/gi, '$1');
    s = s.replace(/\{\{\s*lang-[a-z]{2,3}\s*\|\s*([^|}]*)[^}]*\}\}/gi, '$1');

    // Templates can nest; peel until none are left rather than once.
    for (let i = 0; i < 5 && s.includes('{{'); i += 1) {
        s = s.replace(/\{\{[^{}]*\}\}/g, '');
    }

    s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
    s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
    s = s.replace(/'''([^']+)'''/g, '$1');
    s = s.replace(/''([^']+)''/g, '$1');
    s = s.replace(/<[^>]+>/g, '');

    return s.replace(/\s+/g, ' ').trim();
}

// Fields run until the next "| Name =" at the start of a line, so a summary
// containing pipes or newlines stays whole. The block's own closing braces
// also have to be on their own line: a value is often a template itself
// ({{Start date|...}}), and stopping at those inner braces would cut the
// value in half and leave markup nothing can strip.
function fieldOf(block, name) {
    const re = new RegExp(
        `\\|\\s*${name}\\s*=([\\s\\S]*?)(?=\\n\\s*\\|\\s*\\w+\\s*=|\\n\\s*\\}\\}|$)`,
        'i'
    );
    const m = re.exec(block);
    return m ? cleanWikitext(m[1]) : '';
}

function parseEpisodes(wikitext) {
    if (typeof wikitext !== 'string' || !wikitext) return [];

    const episodes = [];
    // Each {{Episode list...}} block, taken up to its closing braces.
    const blockRe = /\{\{\s*Episode list[\s\S]*?\n\s*\}\}/gi;
    const blocks = wikitext.match(blockRe) || [];

    for (const block of blocks) {
        const title = fieldOf(block, 'Title');
        const summary = fieldOf(block, 'ShortSummary');
        if (!title && !summary) continue;
        const airDate = fieldOf(block, 'OriginalAirDate');

        // A two-part episode that aired as one hour is a single block with
        // numbered variants of each field. Both halves exist as files, so
        // both have to come back, sharing the hour's title and summary.
        const parts = parseInt(fieldOf(block, 'NumParts'), 10);
        if (Number.isFinite(parts) && parts > 1) {
            for (let p = 1; p <= parts; p += 1) {
                const n = parseInt(
                    fieldOf(block, `EpisodeNumber2_${p}`) || fieldOf(block, `EpisodeNumber_${p}`),
                    10
                );
                if (!Number.isFinite(n)) continue;
                episodes.push({ episode: n, title, summary, airDate, parts });
            }
            continue;
        }

        // EpisodeNumber2 is the number within the season, which is what a
        // filename's SxxExx refers to; EpisodeNumber counts the whole series.
        const episode = parseInt(
            fieldOf(block, 'EpisodeNumber2') || fieldOf(block, 'EpisodeNumber'),
            10
        );
        if (!Number.isFinite(episode)) continue;

        episodes.push({ episode, title, summary, airDate });
    }

    return episodes;
}

// SxxExx is authoritative: a Chinese release name also carries 「第09集」,
// and a resolution like 1080p is full of digits that must not be read as one.
function episodeFromName(name) {
    if (typeof name !== 'string' || !name) return null;
    const m = /[sS](\d{1,2})[\s._-]*[eE](\d{1,3})/.exec(name)
        || /(?<![\dxX])(\d{1,2})[xX](\d{2,3})(?![\dxX])/.exec(name);
    if (!m) return null;
    const season = parseInt(m[1], 10);
    const episode = parseInt(m[2], 10);
    if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
    return { season, episode };
}

// Infobox values are routinely multi-line templates whose own closing braces
// sit on their own line, so a line-based split cuts them in half. Walk the
// text counting brace depth instead, and stop at a pipe only at depth zero.
function infoboxField(article, name) {
    return cleanWikitext(infoboxFieldRaw(article, name));
}

// The image field names a file, and cleaning it as a piped link would keep
// the display size instead ("270px"). Callers that need the markup ask here.
function infoboxFieldRaw(article, name) {
    const box = article.indexOf('{{Infobox television');
    if (box < 0) return '';
    const re = new RegExp(`\\n\\s*\\|\\s*${name}\\s*=`, 'i');
    const found = re.exec(article.slice(box));
    if (!found) return '';

    let i = box + found.index + found[0].length;
    let depth = 0;
    let out = '';
    while (i < article.length) {
        const two = article.slice(i, i + 2);
        if (two === '{{' || two === '[[') { depth += 1; out += two; i += 2; continue; }
        if (two === '}}' || two === ']]') {
            if (depth === 0) break;          // the infobox itself ending
            depth -= 1; out += two; i += 2; continue;
        }
        if (depth === 0 && article[i] === '|') break;
        out += article[i];
        i += 1;
    }
    return unwrapLists(out).trim();
}

// A cast or genre is nearly always wrapped in a list template. Stripping it
// as a template would take the names with it, so take off the wrapper and
// keep what it held.
function unwrapLists(value) {
    return value.replace(
        /\{\{\s*(?:Plainlist|Plain list|Unbulleted list|Ubl|ubl|flatlist|hlist)\s*\|([\s\S]*)\}\}/gi,
        '$1'
    );
}

// "* a\n* b" or "a | b" — either way, the names.
function listItems(value) {
    if (!value) return [];
    const bulleted = value.split(/\s*\*\s*/).map(s => s.trim()).filter(Boolean);
    if (bulleted.length > 1) return bulleted;
    return value.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);
}

function parseShow(article) {
    const text = typeof article === 'string' ? article : '';

    // The lead paragraph is the description a viewer wants. en bolds the
    // title with five quotes; zh uses three around a bracketed title, so
    // anchoring on five found nothing and the header came up blank. Take the
    // first real paragraph after the templates instead.
    let description = '';
    const afterBox = (() => {
        const box = text.indexOf('{{Infobox');
        if (box < 0) return text;
        let i = box;
        let depth = 0;
        for (; i < text.length; i += 1) {
            if (text.slice(i, i + 2) === '{{') { depth += 1; i += 1; continue; }
            if (text.slice(i, i + 2) === '}}') {
                depth -= 1; i += 1;
                if (depth === 0) return text.slice(i + 1);
            }
        }
        return text.slice(box);
    })();

    for (const line of afterBox.split('\n')) {
        const trimmed = line.trim();
        // Skip leftover templates, tables, headings and stray markup.
        if (!trimmed || /^[{|!=*#:[<]/.test(trimmed)) continue;
        const cleaned = cleanWikitext(trimmed);
        // Short enough for a dense Chinese sentence to qualify, long enough
        // to skip a stray caption or a one-word line.
        if (cleaned.length > 12) { description = cleaned; break; }
    }

    const years = description.match(/\b(19|20)\d{2}\b/);
    const seasons = parseInt(infoboxField(text, 'num_seasons'), 10);
    const episodes = parseInt(infoboxField(text, 'num_episodes'), 10);

    return {
        description,
        year: years ? parseInt(years[0], 10) : null,
        seasons: Number.isFinite(seasons) ? seasons : null,
        episodes: Number.isFinite(episodes) ? episodes : null,
        genre: listItems(infoboxField(text, 'genre')),
        creators: listItems(infoboxField(text, 'creator')),
        starring: listItems(infoboxField(text, 'starring')),
        country: infoboxField(text, 'country')
    };
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`Wikipedia answered ${res.statusCode}`));
                return;
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (d) => { body += d; });
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Wikipedia sent something unreadable')); }
            });
        });
        req.on('error', (e) => reject(new Error(`Could not reach Wikipedia: ${e.message}`)));
        // Without this a stalled connection would hang the import forever.
        req.setTimeout(20000, () => { req.destroy(new Error('Wikipedia timed out')); });
    });
}

async function fetchPage(title, lang) {
    const url = `${apiHost(lang)}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2`;
    const data = await getJson(url);
    if (data.error) throw new Error(data.error.info || 'Page not found');
    return data.parse?.wikitext || '';
}

async function searchTitles(query, lang) {
    const url = `${apiHost(lang)}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json&formatversion=2`;
    const data = await getJson(url);
    return (data.query?.search || []).map(s => s.title);
}

// Tries the conventional article names first, then falls back to search, so a
// show whose page is named unusually still resolves.
async function fetchSeason(show, season, lang) {
    const attempts = seasonTitles(show, season, lang);
    const direct = attempts[0];

    let wikitext = '';
    let used = '';
    for (const title of attempts) {
        try {
            wikitext = await fetchPage(title, lang);
            used = title;
            break;
        } catch (e) { /* try the next candidate */ }
    }

    if (!wikitext) {
        const query = lang === 'zh' ? `${show} 第${season}季 劇集` : `${show} season ${season} episodes`;
        const found = await searchTitles(query, lang);
        for (const title of found) {
            try {
                wikitext = await fetchPage(title, lang);
                used = title;
                break;
            } catch (e) { /* keep looking */ }
        }
    }

    if (!wikitext) throw new Error(`No Wikipedia article found for "${direct}"`);

    const episodes = parseEpisodes(wikitext);
    if (episodes.length === 0) throw new Error(`"${used}" has no episode list to read`);
    return { page: used, episodes };
}

// Kept inside the library file rather than dropped beside the videos: a
// folder should not grow stray artwork files any more than stray .srt ones.
const MAX_POSTER_BYTES = 700 * 1024;

function fetchBinary(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                fetchBinary(res.headers.location).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`Image fetch returned ${res.statusCode}`));
                return;
            }
            const type = res.headers['content-type'] || 'image/png';
            const chunks = [];
            let total = 0;
            res.on('data', (c) => {
                total += c.length;
                if (total > MAX_POSTER_BYTES) {
                    req.destroy();
                    reject(new Error('Image is too large to keep in the library'));
                    return;
                }
                chunks.push(c);
            });
            res.on('end', () => resolve({ type, buffer: Buffer.concat(chunks) }));
        });
        req.on('error', (e) => reject(new Error(`Could not fetch image: ${e.message}`)));
        req.setTimeout(20000, () => { req.destroy(new Error('Image fetch timed out')); });
    });
}

// The infobox names a file; this turns that into something displayable.
async function fetchImage(fileName, width = 900, lang) {
    if (!fileName) return null;
    // zh infoboxes write the image as a full [[File:x.png|270px]] link.
    const bare = fileName.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0];
    const title = `File:${bare.replace(/^(File|檔案|文件):/i, '')}`;
    const url = `${apiHost(lang)}?action=query&titles=${encodeURIComponent(title)}`
        + `&prop=imageinfo&iiprop=url&iiurlwidth=${width}&format=json&formatversion=2`;

    let info;
    try {
        const data = await getJson(url);
        info = data.query?.pages?.[0]?.imageinfo?.[0];
    } catch (e) {
        return null;
    }
    const src = info?.thumburl || info?.url;
    if (!src) return null;

    try {
        const { type, buffer } = await fetchBinary(src);
        return `data:${type};base64,${buffer.toString('base64')}`;
    } catch (e) {
        return null;
    }
}

async function fetchShow(title, lang) {
    const wikitext = await fetchPage(title, lang);
    const show = { page: title, lang: lang === 'zh' ? 'zh' : 'en', ...parseShow(wikitext) };
    // Artwork is a nicety: a show with none still has everything else. It is
    // hosted on Commons either way, so English resolves it for both.
    show.poster = await fetchImage(infoboxFieldRaw(wikitext, 'image'), 900, 'en');
    return show;
}

module.exports = {
    cleanWikitext, parseEpisodes, episodeFromName, fetchSeason, searchTitles,
    parseShow, fetchShow, fetchImage, infoboxField, infoboxFieldRaw, listItems,
    apiHost, seasonTitles
};
