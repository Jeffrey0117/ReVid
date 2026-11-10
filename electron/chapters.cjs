// Reading chapter sidecars. Main process only.
//
// The split is deliberate: parsing belongs where the files are, and the
// renderer never sees a sidecar — it gets chapters out of the library, already
// cleaned. So nothing here is duplicated in src/utils/chapters.js, which holds
// the other half (which chapter is playing, where its band goes on the bar).
// Putting both halves in one module would have meant the renderer importing a
// CommonJS file, which Vite's dev server does not give a usable shape.

// A label and a range is the whole idea; colour is the only decoration worth
// keeping.
function cleanChapter(raw) {
    if (!raw) return null;
    const t = Number(raw.t != null ? raw.t : raw.start);
    const end = Number(raw.end != null ? raw.end : raw.stop);
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    if (!Number.isFinite(t) || t < 0) return null;
    if (!label) return null;
    // An end that is missing, backwards or equal becomes a point marker
    // rather than being thrown away — the start is the useful half.
    const safeEnd = Number.isFinite(end) && end > t ? end : null;
    const colour = typeof raw.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(raw.color.trim())
        ? raw.color.trim()
        : null;
    const out = { t, end: safeEnd, label };
    if (colour) out.color = colour;
    return out;
}

function normaliseChapters(list) {
    if (!Array.isArray(list)) return [];
    return list.map(cleanChapter).filter(Boolean).sort((a, b) => a.t - b.t);
}

// The sidecar the user's own capture script writes: metadata plus the list.
// The source block is worth keeping — once the file is sitting in a folder
// under a tidied-up name, it is the only record of where it came from.
function parseChapterJson(text) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { return null; }
    if (!raw || typeof raw !== 'object') return null;
    const list = raw.chapters || raw.items || (Array.isArray(raw) ? raw : []);
    const chapters = normaliseChapters(list);
    if (!chapters.length) return null;
    return {
        chapters,
        title: typeof raw.title === 'string' ? raw.title : '',
        duration: Number.isFinite(Number(raw.duration)) ? Number(raw.duration) : null,
        source: raw.source && typeof raw.source === 'object' ? raw.source : null
    };
}

const VTT_TIME = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})|(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function vttSeconds(stamp) {
    const m = VTT_TIME.exec(String(stamp).trim());
    if (!m) return NaN;
    if (m[1] !== undefined) {
        return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
    }
    return Number(m[5]) * 60 + Number(m[6]) + Number(m[7].padEnd(3, '0')) / 1000;
}

// The fallback, for when only the .vtt survived. It carries no colours.
function parseChapterVtt(text) {
    if (typeof text !== 'string') return [];
    const out = [];
    const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
    for (const block of blocks) {
        const lines = block.split('\n').filter(Boolean);
        const arrow = lines.findIndex(l => l.includes('-->'));
        if (arrow < 0) continue;
        const parts = lines[arrow].split('-->');
        const label = lines.slice(arrow + 1).join(' ').trim();
        if (!label) continue;
        out.push({ t: vttSeconds(parts[0]), end: vttSeconds(parts[1]), label });
    }
    return normaliseChapters(out);
}

module.exports = { normaliseChapters, parseChapterJson, parseChapterVtt };
