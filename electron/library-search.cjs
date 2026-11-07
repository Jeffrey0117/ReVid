// "Which episode was the bit about the bar?" — the transcripts to answer that
// are already sitting in every folder's .revid, so the search is local and
// needs nothing online. An AI layer can sit on top of this later; it would
// still need these hits to point at a moment in a file.
const fs = require('fs');
const path = require('path');
const library = require('./library-file.cjs');

// A line containing the whole phrase beats one that merely contains every
// word somewhere, which is almost always what the person meant.
const PHRASE = 2;
const TERMS = 1;

const VIDEO_RE = /\.(mp4|webm|mov|avi|mkv|m4v)$/i;

// The query is text someone typed, never a pattern: '.*' searches for a dot
// followed by a star.
function termsOf(query) {
    if (typeof query !== 'string') return [];
    return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function matchCues(cues, query) {
    if (!Array.isArray(cues) || cues.length === 0) return [];
    const phrase = typeof query === 'string' ? query.trim().toLowerCase() : '';
    if (!phrase) return [];
    const terms = termsOf(phrase);

    const hits = [];
    for (let index = 0; index < cues.length; index += 1) {
        const cue = cues[index];
        const hay = `${cue.text || ''}\n${cue.zh || ''}`.toLowerCase();

        let score = 0;
        if (hay.includes(phrase)) score = PHRASE;
        else if (terms.length > 1 && terms.every(t => hay.includes(t))) score = TERMS;
        if (!score) continue;

        hits.push({
            index, score,
            start: cue.start, end: cue.end,
            text: cue.text || '', zh: cue.zh || ''
        });
    }

    return hits.sort((a, b) => b.score - a.score || a.start - b.start);
}

// Scored the same way as a line, but it answers a different question: not
// "who said that" but "which episode was the one about X" — which the
// dialogue itself never states.
function matchGuide(guide, query) {
    if (!guide || (!guide.title && !guide.summary)) return null;
    const phrase = typeof query === 'string' ? query.trim().toLowerCase() : '';
    if (!phrase) return null;

    const hay = `${guide.title || ''}\n${guide.summary || ''}`.toLowerCase();
    const terms = termsOf(phrase);

    let score = 0;
    if (hay.includes(phrase)) score = PHRASE;
    else if (terms.length > 1 && terms.every(t => hay.includes(t))) score = TERMS;
    if (!score) return null;

    return {
        kind: 'episode',
        score,
        episode: guide.episode,
        title: guide.title || '',
        summary: guide.summary || '',
        airDate: guide.airDate || ''
    };
}

// Past this many, an episode match means the words are common rather than
// that the query is about an episode — so drop them all and leave the lines.
const MAX_EPISODE_HITS = 8;

function capEpisodeHits(results) {
    const episodes = results.filter(r => r.kind === 'episode');
    if (episodes.length <= MAX_EPISODE_HITS) return results;
    return results.filter(r => r.kind !== 'episode');
}

// The folder being viewed can arrive with forward slashes (from a path built
// in the renderer) while readdir yields backslashes, and Windows does not care
// about case. Compare on a single normal form or the same folder gets searched
// twice and every hit in it is reported twice.
const sameDir = (a) => {
    const resolved = path.resolve(a);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

// Folders worth searching. Siblings are included for "all seasons", because
// S01/S02/S03 normally sit next to each other under one show.
function foldersInScope(folder, scope) {
    if (!folder) return [];
    if (scope !== 'siblings') return [folder];

    const parent = path.dirname(folder);
    if (!parent || parent === folder) return [folder];

    let names;
    try { names = fs.readdirSync(parent, { withFileTypes: true }); } catch (e) { return [folder]; }

    const found = names
        .filter(d => d.isDirectory())
        .map(d => path.join(parent, d.name))
        .filter(dir => fs.existsSync(library.libraryPathFor(dir)));

    // Always keep the folder being viewed, even if it has no library yet.
    const key = sameDir(folder);
    const deduped = found.filter(dir => sameDir(dir) !== key);
    return [folder, ...deduped];
}

// Returns at most `limit` hits across the scope, newest-first by nothing in
// particular — ordering is by relevance, then by where they fall in an episode.
function search({ folder, query, scope = 'folder', limit = 200 }) {
    const phrase = typeof query === 'string' ? query.trim() : '';
    if (!phrase) return { success: true, results: [], searched: 0 };

    const results = [];
    const folders = foldersInScope(folder, scope);
    let searched = 0;

    for (const dir of folders) {
        let lib;
        try { lib = library.read(dir); } catch (e) { continue; }
        if (!lib?.videos) continue;

        for (const [name, entry] of Object.entries(lib.videos)) {
            if (!VIDEO_RE.test(name)) continue;
            const where = { folder: dir, name, videoPath: path.join(dir, name) };

            // An episode match comes first: it names the episode, where a
            // line match only names a moment inside one.
            const guideHit = matchGuide(entry.guide, phrase);
            if (guideHit) results.push({ ...guideHit, ...where, start: 0 });

            if (!Array.isArray(entry.subs)) continue;
            searched += 1;
            const cues = entry.subs.map(library.unpackCue);
            for (const hit of matchCues(cues, phrase)) {
                results.push({ kind: 'line', ...hit, ...where });
                if (results.length >= limit * 4) break;
            }
        }
    }

    const kept = capEpisodeHits(results);
    const episodesDropped = results.length - kept.length;

    // Episode matches lead: "which episode" is the bigger answer, and the
    // line matches below it say where inside.
    const rank = (r) => (r.kind === 'episode' ? 1 : 0);
    kept.sort((a, b) =>
        rank(b) - rank(a) || b.score - a.score
        || a.name.localeCompare(b.name) || a.start - b.start);
    return {
        success: true,
        results: kept.slice(0, limit),
        truncated: kept.length > limit,
        // Never silently: the UI says the words were too common to narrow by.
        episodesDropped,
        searched,
        folders: folders.length
    };
}

module.exports = {
    matchCues, matchGuide, search, foldersInScope, capEpisodeHits,
    PHRASE, TERMS, MAX_EPISODE_HITS
};
