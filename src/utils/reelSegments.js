// Turning picked transcript lines into a vertical short: the clips are joined
// end to end, so every cue has to be re-timed onto that new timeline before it
// can be burned in. Ranges carry the cue indices they were built from, so the
// mapping is exact — no guessing from overlapping timestamps.

// A cue boundary taken literally clips the first and last syllable, so each
// clip reaches a little past its line. Must match the padding the cut uses.
export const PAD = { start: 0.15, end: 0.25 };

// Where a range actually starts and how long it runs once padded. A line near
// the very beginning cannot pad backwards, so the clip is shorter there.
export function clipFor(range) {
    const start = Math.max(0, range.start - PAD.start);
    return { start, duration: (range.end + PAD.end) - start };
}

export function totalDuration(ranges) {
    return ranges.reduce((n, r) => n + clipFor(r).duration, 0);
}

// Cues laid out against the joined video, in seconds from its start.
export function retimeCues(cues, ranges) {
    const segments = [];
    let offset = 0;

    for (const range of ranges) {
        const clip = clipFor(range);
        for (let i = range.startIndex; i <= range.endIndex; i += 1) {
            const cue = cues[i];
            if (!cue) continue;
            const start = offset + (cue.start - clip.start);
            const end = offset + (cue.end - clip.start);
            if (end <= start) continue;
            segments.push({
                start,
                end,
                // The burned line shows both languages when both exist; the
                // player's own toggle does not reach a finished file.
                text: cue.zh ? `${cue.text}\n${cue.zh}` : cue.text
            });
        }
        offset += clip.duration;
    }

    return segments;
}
