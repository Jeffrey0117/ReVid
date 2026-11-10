// Chapter markers: named time ranges inside one video. Renderer half.
//
// Not the same thing as subtitles. A cue covers every moment of speech and
// the next one starts where the last ended; chapters are a handful of marked
// stretches with gaps between them, and most of a video belongs to no chapter
// at all. Anything that assumes they tile the timeline gets the gaps wrong.
//
// Reading the sidecar files is electron/chapters.cjs — this side only ever
// sees chapters that already came out of the library, cleaned.

// Which chapter the playhead is inside, or null — most of a video is gap.
// A chapter with no end runs until the next one starts.
export function chapterAt(chapters, time) {
    if (!Array.isArray(chapters) || !Number.isFinite(time)) return null;
    for (let i = 0; i < chapters.length; i++) {
        const c = chapters[i];
        if (time < c.t) return null;              // sorted: nothing earlier can match
        const end = c.end ?? (chapters[i + 1] ? chapters[i + 1].t : Infinity);
        if (time < end) return c;
    }
    return null;
}

// Where to paint each band on the progress bar, as percentages of the whole.
// A marker with no end gets a hairline rather than being stretched to the
// next one: the stretch would claim time the marker never said anything about.
export const POINT_WIDTH_PCT = 0.4;

export function chapterBands(chapters, duration) {
    if (!Array.isArray(chapters) || !(duration > 0)) return [];
    return chapters.map((c) => {
        const left = Math.max(0, Math.min(100, (c.t / duration) * 100));
        const width = c.end
            ? Math.max(POINT_WIDTH_PCT, Math.min(100 - left, ((c.end - c.t) / duration) * 100))
            : POINT_WIDTH_PCT;
        return { ...c, left, width };
    });
}

// The next chapter start after `time`, for skipping forward.
export function nextChapter(chapters, time) {
    if (!Array.isArray(chapters)) return null;
    return chapters.find(c => c.t > time + 0.05) || null;
}

// The previous start — with the usual media-player behaviour of jumping to
// the beginning of the current chapter first, rather than straight past it.
export function prevChapter(chapters, time) {
    if (!Array.isArray(chapters) || !chapters.length) return null;
    const here = chapterAt(chapters, time);
    if (here && time - here.t > 1.5) return here;   // well inside: restart it

    // Only just inside one, or in a gap: look for a start before this point.
    // The limit is the current chapter's own start, not the clock — a second
    // into a chapter, every start "before now" still includes itself, and the
    // press would do nothing.
    const limit = here ? here.t : time - 0.05;
    let found = null;
    for (const c of chapters) {
        if (c.t < limit - 0.001) found = c; else break;
    }
    // Nothing before it: restarting where you are beats doing nothing.
    return found || here || null;
}
