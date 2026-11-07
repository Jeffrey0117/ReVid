// SRT in and out, in the main process. The renderer has its own parser for
// what it fetches; this one exists so the library file, the transcription
// pipeline and the export path all agree on the same shape.

const TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function parseTime(str) {
    const m = String(str).match(TIME);
    if (!m) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

function parse(content) {
    const text = String(content).replace(/^﻿/, '').replace(/\r/g, '');
    const cues = [];
    for (const block of text.split(/\n{2,}/)) {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        const i = lines.findIndex(l => l.includes('-->'));
        if (i === -1) continue;
        const [a, b] = lines[i].split('-->');
        const start = parseTime(a);
        const end = parseTime(b);
        if (start == null || end == null || end <= start) continue;
        const body = lines.slice(i + 1).join('\n').trim();
        if (body) cues.push({ start, end, text: body });
    }
    return cues;
}

function stamp(s) {
    const safe = Math.max(0, s || 0);
    const h = String(Math.floor(safe / 3600)).padStart(2, '0');
    const m = String(Math.floor((safe % 3600) / 60)).padStart(2, '0');
    const sec = String(Math.floor(safe % 60)).padStart(2, '0');
    const ms = String(Math.round((safe - Math.floor(safe)) * 1000)).padStart(3, '0');
    return `${h}:${m}:${sec},${ms}`;
}

// `field` picks which text to write, so the same cue list can produce the
// original and the translated file.
function serialize(cues, field = 'text') {
    return (cues || [])
        .map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c[field] || ''}\n`)
        .join('\n');
}

module.exports = { parse, serialize, stamp };
