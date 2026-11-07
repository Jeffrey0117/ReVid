// What the advanced tier unlocks.
//
// ReVid is a player first. The advanced features are the ones that cost real
// money to run (cloud AI) or took disproportionate work to build — not a
// theme. Naming matters here: this is "進階" (advanced), because the tier is
// not about learning. Learning is one thing it happens to be good at; cloud
// libraries, virtualisation and the rest are not.
//
// Nothing here is a security boundary. The checks keep the UI honest for
// people who have not paid; a local build can always be edited. Anything that
// must actually be protected (cloud transcription, LLM translation) is gated
// server-side at the API, where the cost is incurred.

export const TIER = { FREE: 'free', ADVANCED: 'advanced' };

// Feature keys used across the app. Grouped by what they cost to provide.
export const FEATURES = {
    // Local compute — free. These are what a player is for.
    PLAYBACK: 'playback',
    TRIM_EXPORT: 'trim-export',
    BATCH_CUT: 'batch-cut',
    PLUGINS: 'plugins',
    LOCAL_SUBTITLES: 'local-subtitles',

    // Built on top, no running cost, but a lot of work — the tier's value.
    LEARNING: 'learning',           // difficult-word marking, word list
    TRANSCRIPT_TOOLS: 'transcript', // inline editing, cut-by-line
    PDF_EXPORT: 'pdf-export',

    // Real per-use cost to whoever runs it.
    CLOUD_TRANSCRIBE: 'cloud-transcribe',
    AI_TRANSLATE: 'ai-translate',
    AI_PHRASES: 'ai-phrases'
};

const ADVANCED_ONLY = new Set([
    FEATURES.LEARNING,
    FEATURES.TRANSCRIPT_TOOLS,
    FEATURES.PDF_EXPORT,
    FEATURES.CLOUD_TRANSCRIBE,
    FEATURES.AI_TRANSLATE,
    FEATURES.AI_PHRASES
]);

const LICENSE_KEY = 'revid-license';

export function readLicense() {
    try {
        const raw = JSON.parse(localStorage.getItem(LICENSE_KEY));
        if (!raw || typeof raw !== 'object') return { tier: TIER.FREE };
        // An expiry in the past is not a licence.
        if (raw.expiresAt && Date.now() > raw.expiresAt) return { tier: TIER.FREE, expired: true };
        return { tier: raw.tier === TIER.ADVANCED ? TIER.ADVANCED : TIER.FREE, ...raw };
    } catch {
        return { tier: TIER.FREE };
    }
}

export function writeLicense(license) {
    try { localStorage.setItem(LICENSE_KEY, JSON.stringify(license)); } catch { /* full */ }
}

export function clearLicense() {
    try { localStorage.removeItem(LICENSE_KEY); } catch { /* ignore */ }
}

// During development every feature is on, so building and testing is never
// blocked by a licence that does not exist yet.
const DEV_UNLOCK = import.meta.env?.DEV === true;

export function hasFeature(feature, license = readLicense()) {
    if (DEV_UNLOCK) return true;
    if (!ADVANCED_ONLY.has(feature)) return true;
    return license.tier === TIER.ADVANCED;
}

export function isAdvanced(license = readLicense()) {
    return DEV_UNLOCK || license.tier === TIER.ADVANCED;
}
