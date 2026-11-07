// Transcripts answer "who said that line". They do not answer "which episode
// was the one at the wedding" — nobody says the title out loud. Wikipedia's
// season articles carry a synopsis per episode, which is exactly that index,
// so the library can hold it alongside the subtitles and be searched together.
const https = require('https');

const API = 'https://en.wikipedia.org/w/api.php';
const UA = 'ReVid/0.7 (local media library; episode synopses)';

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

async function fetchPage(title) {
    const url = `${API}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2`;
    const data = await getJson(url);
    if (data.error) throw new Error(data.error.info || 'Page not found');
    return data.parse?.wikitext || '';
}

async function searchTitles(query) {
    const url = `${API}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json&formatversion=2`;
    const data = await getJson(url);
    return (data.query?.search || []).map(s => s.title);
}

// Tries the conventional article name first, then falls back to search, so a
// show whose page is named unusually still resolves.
async function fetchSeason(show, season) {
    const direct = `${show} season ${season}`;
    const attempts = [direct];

    let wikitext = '';
    let used = '';
    for (const title of attempts) {
        try {
            wikitext = await fetchPage(title);
            used = title;
            break;
        } catch (e) { /* try the next candidate */ }
    }

    if (!wikitext) {
        const found = await searchTitles(`${show} season ${season} episodes`);
        for (const title of found) {
            try {
                wikitext = await fetchPage(title);
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

module.exports = { cleanWikitext, parseEpisodes, episodeFromName, fetchSeason, searchTitles };
