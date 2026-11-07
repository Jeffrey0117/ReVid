// Subtitle translation. Two engines:
//
//   google — free, no key. Uses the clients5 "dict-chrome-ex" POST endpoint,
//            NOT translate.googleapis.com/translate_a/single: that one blocks
//            Node/undici connection fingerprints and 429s immediately, which
//            is exactly what a main-process request looks like.
//   gemini — needs a key. Batches through the OpenAI-compatible endpoint with
//            a NUMBERED-KEY JSON response: subtitle lines are short fragments
//            and an LLM will happily merge or drop them, so a plain array
//            can't be trusted to line up. Missing keys fall back to source.
const { net } = require('electron');
const OpenCC = require('opencc-js');

// Google returns a mix of Simplified and Traditional even with tl=zh-TW, so
// every result is normalised to Traditional. Converting text that is ALREADY
// Traditional corrupts it (看表演 → 看錶演), so convert only lines that are
// unchanged by a Traditional→Simplified pass, i.e. lines with no
// Traditional-only characters.
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const toTraditional = OpenCC.Converter({ from: 'cn', to: 'twp' });

function normalizeTraditional(text) {
    if (!text) return text;
    return toSimplified(text) !== text ? text : toTraditional(text);
}

const GOOGLE_ENDPOINT = 'https://clients5.google.com/translate_a/t';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
const BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const GOOGLE_CHUNK_CHARS = 2800;
const GEMINI_CHUNK_LINES = 25;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chromium's network stack — fewer bot-fingerprint rejections than undici.
const doFetch = (url, opts) => (net?.fetch ? net.fetch(url, opts) : fetch(url, opts));

function parseGoogleBody(data) {
    if (!Array.isArray(data)) return null;
    const first = data[0];
    if (typeof first === 'string') return first;
    if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
    return null;
}

// Pack lines into newline-joined requests. A batch whose response doesn't come
// back with the same number of lines is retried one line at a time rather than
// silently mis-aligning subtitles.
async function translateGoogle(lines, targetLang, onProgress) {
    const params = new URLSearchParams({ client: 'dict-chrome-ex', sl: 'auto', tl: targetLang });
    const url = `${GOOGLE_ENDPOINT}?${params}`;

    const sendOne = async (text) => {
        for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) await sleep(800 * 2 ** (attempt - 1));
            let res;
            try {
                res = await doFetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': BROWSER_UA
                    },
                    body: new URLSearchParams({ q: text })
                });
            } catch (e) {
                continue; // network blip — retry
            }
            if (res.ok) {
                const parsed = parseGoogleBody(await res.json());
                if (parsed !== null) return parsed;
                return null;
            }
            if (res.status !== 429 && res.status < 500) return null;
        }
        return null;
    };

    // Build newline-packed chunks.
    const chunks = [];
    let current = [];
    let size = 0;
    for (const line of lines) {
        const flat = line.replace(/\n/g, ' ');
        if (current.length && size + flat.length + 1 > GOOGLE_CHUNK_CHARS) {
            chunks.push(current);
            current = [];
            size = 0;
        }
        current.push(flat);
        size += flat.length + 1;
    }
    if (current.length) chunks.push(current);

    const out = [];
    let done = 0;
    for (const chunk of chunks) {
        const body = await sendOne(chunk.join('\n'));
        const split = body == null ? null : body.split('\n');
        if (split && split.length === chunk.length) {
            out.push(...split.map((s, i) => s.trim() || chunk[i]));
        } else {
            // Line count mismatch means the packing can't be trusted for this
            // chunk — fall back to one request per line.
            for (const line of chunk) {
                const single = await sendOne(line);
                out.push((single || '').trim() || line);
                await sleep(120);
            }
        }
        done += chunk.length;
        onProgress?.(Math.round((done / lines.length) * 100));
        await sleep(200);
    }
    return out;
}

async function translateGeminiChunk(batch, targetName, apiKey, model) {
    const numbered = batch.map((t, i) => `${i + 1}. ${(t || '').replace(/\n/g, ' ')}`).join('\n');
    const prompt =
        `下面是 ${batch.length} 句影片字幕(可能是句子的片段)。逐句翻成${targetName},` +
        `口語自然、不直譯、保留原意與語氣。每句獨立翻,不要合併、不要拆分、不要省略任何一句。\n` +
        `回傳 JSON 物件: key = 句子編號(字串), value = 該句譯文。1 到 ${batch.length} 每個編號都必須有。` +
        `只回 JSON, 不要其他文字:\n\n${numbered}\n\n格式範例: {"1":"譯文1","2":"譯文2"}`;

    const res = await doFetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: model || DEFAULT_GEMINI_MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 4096,
            reasoning_effort: 'none' // 2.5-flash otherwise spends max_tokens thinking
        })
    });
    if (!res.ok) {
        throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
    }

    const json = await res.json();
    let content = (json.choices?.[0]?.message?.content || '').trim();
    if (content.startsWith('```')) {
        content = content.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '').trim();
    }

    let parsed = null;
    try { parsed = JSON.parse(content); } catch (e) { parsed = null; }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return batch.map((orig, i) => {
            const v = parsed[String(i + 1)];
            return typeof v === 'string' && v.trim() ? v.trim() : orig;
        });
    }
    if (Array.isArray(parsed) && parsed.length === batch.length) {
        return parsed.map((x, i) => String(x).trim() || batch[i]);
    }
    return batch; // unparseable — keep source rather than dropping lines
}

async function translateGemini(lines, targetName, apiKey, model, onProgress) {
    const out = [];
    for (let i = 0; i < lines.length; i += GEMINI_CHUNK_LINES) {
        const batch = lines.slice(i, i + GEMINI_CHUNK_LINES);
        out.push(...await translateGeminiChunk(batch, targetName, apiKey, model));
        onProgress?.(Math.round((Math.min(i + GEMINI_CHUNK_LINES, lines.length) / lines.length) * 100));
    }
    return out;
}

// Returns { success, translations[] } aligned 1:1 with `lines`.
async function translateLines(lines, { engine, apiKey, model, targetLang = 'zh-TW' }, onProgress) {
    if (!Array.isArray(lines) || lines.length === 0) {
        return { success: false, error: 'Nothing to translate' };
    }
    try {
        const raw = engine === 'gemini'
            ? await translateGemini(lines, '繁體中文', apiKey, model, onProgress)
            : await translateGoogle(lines, targetLang, onProgress);
        const translations = raw.map(normalizeTraditional);

        // A middleman that echoes the source for every line looks like success
        // but produces untranslated subtitles — treat that as a failure.
        const changed = translations.filter((t, i) => t && t !== lines[i]).length;
        if (changed === 0) {
            return { success: false, error: 'Translation returned the original text' };
        }
        return { success: true, translations };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

module.exports = { translateLines, DEFAULT_GEMINI_MODEL };
