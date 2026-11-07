// SRT / VTT parsing into [{ start, end, text }] (seconds). Tolerant of the
// usual real-world sloppiness: BOM, CRLF, missing indices, multi-line cues.

const TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;
const SHORT_TIME_RE = /(\d{1,2}):(\d{2})[.,](\d{1,3})/; // VTT allows mm:ss.mmm

function parseTime(str) {
    let m = str.match(TIME_RE);
    if (m) {
        return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
    }
    m = str.match(SHORT_TIME_RE);
    if (m) {
        return Number(m[1]) * 60 + Number(m[2]) + Number(m[3].padEnd(3, '0')) / 1000;
    }
    return null;
}

function stripTags(text) {
    return text.replace(/<[^>]+>/g, '').trim();
}

export function parseSubtitles(content, format = 'srt') {
    const text = content.replace(/^﻿/, '').replace(/\r/g, '');
    const blocks = text.split(/\n{2,}/);
    const cues = [];

    for (const block of blocks) {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) continue;

        const timeLineIdx = lines.findIndex(l => l.includes('-->'));
        if (timeLineIdx === -1) continue;

        const [startStr, endStr] = lines[timeLineIdx].split('-->');
        const start = parseTime(startStr || '');
        const end = parseTime(endStr || '');
        if (start == null || end == null || end <= start) continue;

        const body = lines.slice(timeLineIdx + 1).map(stripTags).filter(Boolean).join('\n');
        if (!body) continue;
        cues.push({ start, end, text: body });
    }

    cues.sort((a, b) => a.start - b.start);
    return cues;
}

export function findActiveCueIndex(cues, time) {
    // Binary search for the last cue starting at/before `time`, then check
    // containment — cues are sorted and rarely overlap.
    let lo = 0;
    let hi = cues.length - 1;
    let candidate = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (cues[mid].start <= time) { candidate = mid; lo = mid + 1; }
        else hi = mid - 1;
    }
    if (candidate >= 0 && time <= cues[candidate].end) return candidate;
    return -1;
}
