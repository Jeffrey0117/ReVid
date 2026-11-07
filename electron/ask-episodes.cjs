// Asking a question rather than matching words: "which one is about trust",
// "the episode where someone gets caught lying". Literal search cannot answer
// that, and the synopses are small enough to simply hand over and ask.
//
// It goes through the Claude Code CLI the user already has installed, so
// there is no second API key to configure and nothing new to sign up for.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const library = require('./library-file.cjs');

const MAX_ANSWERS = 8;
const TIMEOUT_MS = 90000;
const VIDEO_RE = /\.(mp4|webm|mov|avi|mkv|m4v)$/i;

// Indices, not filenames: a model that has to echo "神烦警探 S02E09 「第09集」
// 糖果.mp4" back exactly will eventually get a character wrong, and then the
// answer points at nothing.
function buildCorpus(entries) {
    return entries.map((e, i) => {
        const g = e.guide || {};
        const title = g.title || e.name.replace(/\.[^.]+$/, '');
        const ep = Number.isFinite(g.episode) ? `E${String(g.episode).padStart(2, '0')}` : '';
        return `${i} | ${ep} ${title} | ${g.summary || ''}`.replace(/\s+/g, ' ').trim();
    }).join('\n');
}

// Models wrap JSON in prose and fences however they feel. Take the first
// array that parses and ignore everything around it.
function parseAnswer(raw, entries) {
    if (typeof raw !== 'string' || !raw.trim()) return [];

    let parsed = null;
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start >= 0 && end > start) {
        try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch (e) { parsed = null; }
    }
    if (!Array.isArray(parsed)) return [];

    const seen = new Set();
    const picked = [];
    for (const item of parsed) {
        const i = Number(item?.i);
        if (!Number.isInteger(i) || i < 0 || i >= entries.length) continue;
        if (seen.has(i)) continue;
        seen.add(i);
        picked.push({
            ...entries[i],
            why: typeof item.why === 'string' ? item.why.slice(0, 300) : ''
        });
        if (picked.length >= MAX_ANSWERS) break;
    }
    return picked;
}

// Everything in scope that has a synopsis; without one there is nothing to
// reason about and the episode would only add noise.
function collectEntries(folders) {
    const entries = [];
    for (const dir of folders) {
        let lib;
        try { lib = library.read(dir); } catch (e) { continue; }
        if (!lib?.videos) continue;
        for (const [name, entry] of Object.entries(lib.videos)) {
            if (!VIDEO_RE.test(name) || !entry.guide) continue;
            entries.push({
                name,
                folder: dir,
                videoPath: path.join(dir, name),
                guide: entry.guide
            });
        }
    }
    return entries;
}

const PROMPT_HEAD = [
    'Below is a numbered list of TV episodes: index | episode title | synopsis.',
    'Answer the question by choosing the episodes that fit.',
    '',
    'Reply with ONLY a JSON array, no prose, no code fence:',
    '[{"i": <index>, "why": "<one short sentence, in the language of the question>"}]',
    `At most ${MAX_ANSWERS}, best first. If none fit, reply [].`,
    'Use only indices from the list.'
].join('\n');

function runClaude(prompt) {
    return new Promise((resolve, reject) => {
        // The bare CLI loads the whole Claude Code preamble and every CLAUDE.md
        // on the machine — about six times the tokens for the same answer. The
        // flags below cut it down to this one question.
        const args = [
            '-p', '--output-format', 'json', '--max-turns', '1',
            '--system-prompt', 'You identify TV episodes from their synopses. Answer only in the requested format.',
            '--exclude-dynamic-system-prompt-sections',
            '--setting-sources', '',
            '--strict-mcp-config',
            '--disallowed-tools', 'Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,NotebookEdit'
        ];

        // No shell: it concatenates rather than escapes, so a system prompt
        // containing spaces would arrive in pieces. The CLI is a real
        // executable on every platform, so PATH lookup is enough.
        const child = spawn('claude', args, { windowsHide: true });

        let out = '';
        let err = '';
        let done = false;
        const finish = (fn, arg) => { if (!done) { done = true; fn(arg); } };

        const timer = setTimeout(() => {
            child.kill();
            finish(reject, new Error('Claude took too long to answer'));
        }, TIMEOUT_MS);

        child.stdout.on('data', (d) => { out += d.toString(); });
        child.stderr.on('data', (d) => { err = (err + d.toString()).slice(-1000); });

        child.on('error', (e) => {
            clearTimeout(timer);
            finish(reject, new Error(
                e.code === 'ENOENT'
                    ? 'The claude command was not found on this machine.'
                    : `Could not run claude: ${e.message}`
            ));
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                finish(reject, new Error(`claude exited ${code}. ${err.trim().slice(-300)}`));
                return;
            }
            try {
                const envelope = JSON.parse(out);
                if (envelope.is_error) throw new Error(envelope.result || 'Claude reported an error');
                finish(resolve, {
                    text: envelope.result || '',
                    cost: envelope.total_cost_usd
                });
            } catch (e) {
                finish(reject, new Error(`Could not read Claude's reply: ${e.message}`));
            }
        });

        // A child that dies before reading the prompt makes this write fail.
        // Unhandled, that error event takes the whole process down; the exit
        // handler above already reports the real reason.
        child.stdin.on('error', () => {});
        child.stdin.end(prompt, 'utf8');
    });
}

async function ask({ folders, question }) {
    const q = typeof question === 'string' ? question.trim() : '';
    if (!q) return { success: true, results: [] };

    const entries = collectEntries(folders || []);
    if (entries.length === 0) {
        return { success: false, error: 'NO_GUIDES', results: [] };
    }

    // The episode list goes before the question, never after. Prompt caching
    // matches on a prefix, so a question placed first invalidates the whole
    // list behind it and every search pays to send all of it again.
    const prompt = `${PROMPT_HEAD}\n\nEpisodes:\n${buildCorpus(entries)}\n\nQuestion: ${q}\n`;

    let answer;
    try {
        answer = await runClaude(prompt);
    } catch (e) {
        return { success: false, error: e.message, results: [] };
    }

    return {
        success: true,
        results: parseAnswer(answer.text, entries).map(r => ({
            kind: 'ai',
            name: r.name,
            folder: r.folder,
            videoPath: r.videoPath,
            start: 0,
            title: r.guide.title || '',
            summary: r.guide.summary || '',
            why: r.why
        })),
        considered: entries.length,
        cost: answer.cost
    };
}

module.exports = { ask, buildCorpus, parseAnswer, collectEntries, MAX_ANSWERS };
