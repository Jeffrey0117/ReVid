// Is this folder name one season of a show?
//
// Sweeping a folder's siblings exists so that opening season five queues the
// whole show. The assumption underneath it is that the folder sits inside a
// show folder — and when it does not, "every folder beside this one" is the
// user's home directory. Opening one clip in Videos\ swept Downloads\ and
// queued 194 unrelated files for transcription, permanently, because the
// swept list is replayed on every launch.
//
// So the fan-out only applies between folders that actually look like seasons.

const PATTERNS = [
    /^s\s*\d{1,2}$/i,                 // s1, s01, S 5
    /^season\s*[-_]?\s*\d{1,2}$/i,    // season2, Season-10, season 3
    /^第\s*[0-9一二三四五六七八九十]{1,3}\s*季$/,  // 第5季, 第十二季
    /^(?:season|s)\d{1,2}[-_ ]/i      // S01-something
];

function looksLikeSeason(name) {
    if (typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (!trimmed) return false;
    return PATTERNS.some(re => re.test(trimmed));
}

module.exports = { looksLikeSeason };
