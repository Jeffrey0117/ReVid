// Locates a known audio segment inside other videos. Used by batch cut:
// the user marks a "fixed segment" in one file, and every other file is
// scanned for the same audio to find where to cut.
//
// Method: decode mono 4kHz PCM via ffmpeg, reduce to an RMS envelope
// (10ms frames), then slide the template over the target with normalized
// cross-correlation. Identical source content scores ≈1.0; unrelated
// audio stays well below the match threshold.
const { spawn } = require('child_process');
const { ffmpegPath, trackFfmpegProc } = require('./ffmpeg-runner.cjs');

const SAMPLE_RATE = 4000;
const HOP = 40; // 10ms per envelope frame at 4kHz
const FRAMES_PER_SECOND = SAMPLE_RATE / HOP;
const MATCH_THRESHOLD = 0.6;

// Decode (part of) a file's audio track to a mono PCM buffer, then collapse
// it to an RMS envelope. Returns null when the file has no decodable audio.
function extractEnvelope(filePath, { op, start, duration } = {}) {
    return new Promise((resolve) => {
        const args = ['-hide_banner', '-v', 'error'];
        if (Number.isFinite(start)) args.push('-ss', String(start));
        args.push('-i', filePath);
        if (Number.isFinite(duration)) args.push('-t', String(duration));
        args.push('-map', 'a:0?', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1');

        const proc = spawn(ffmpegPath, args);
        if (op) trackFfmpegProc(op, proc);

        const chunks = [];
        let total = 0;
        // 2h of 4kHz s16 mono ≈ 58MB — cap well above that as a safety net.
        const MAX_BYTES = 200 * 1024 * 1024;

        proc.stdout.on('data', (d) => {
            total += d.length;
            if (total > MAX_BYTES) { try { proc.kill(); } catch (e) { /* exited */ } return; }
            chunks.push(d);
        });
        proc.stderr.on('data', () => {});
        proc.on('error', () => resolve(null));
        proc.on('close', () => {
            if (total < HOP * 2 * 10) { resolve(null); return; } // <100ms of audio
            // No explicit length: after a MAX_BYTES kill, `chunks` holds less
            // than `total`, and padding with zeros would fake silence.
            const pcm = Buffer.concat(chunks);
            const sampleCount = Math.floor(pcm.length / 2);
            const frames = Math.floor(sampleCount / HOP);
            const env = new Float64Array(frames);
            for (let f = 0; f < frames; f++) {
                let acc = 0;
                const base = f * HOP;
                for (let i = 0; i < HOP; i++) {
                    const s = pcm.readInt16LE((base + i) * 2) / 32768;
                    acc += s * s;
                }
                env[f] = Math.sqrt(acc / HOP);
            }
            resolve(env);
        });
    });
}

function buildPrefix(env) {
    const n = env.length;
    const prefix = new Float64Array(n + 1);
    const prefixSq = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
        prefix[i + 1] = prefix[i] + env[i];
        prefixSq[i + 1] = prefixSq[i] + env[i] * env[i];
    }
    return { prefix, prefixSq };
}

// Core NCC scan: slide a zero-mean template over target, windowed mean/σ via
// precomputed prefix sums. Scans only lags in [from, to]. Returns per-lag best
// plus the full score array when collectAll is set (for coarse candidates).
function nccScan(targetEnv, pre, tCentered, tNorm, m, from, to, collectAll) {
    const n = targetEnv.length;
    const { prefix, prefixSq } = pre;

    const lo = Math.max(0, from);
    const hi = Math.min(n - m, to);
    const scores = collectAll ? new Float64Array(Math.max(0, hi - lo + 1)) : null;

    let bestScore = -Infinity;
    let bestLag = lo;
    for (let lag = lo; lag <= hi; lag++) {
        const wSum = prefix[lag + m] - prefix[lag];
        const wSumSq = prefixSq[lag + m] - prefixSq[lag];
        const wVar = wSumSq - (wSum * wSum) / m;
        if (wVar < 1e-12) { if (scores) scores[lag - lo] = -1; continue; }

        let dot = 0;
        for (let i = 0; i < m; i++) {
            dot += tCentered[i] * targetEnv[lag + i];
        }
        // Σ tc·(s − wMean) = Σ tc·s − wMean·Σ tc, and Σ tc = 0 by construction.
        const score = dot / (tNorm * Math.sqrt(wVar));
        if (scores) scores[lag - lo] = score;
        if (score > bestScore) {
            bestScore = score;
            bestLag = lag;
        }
    }
    return { bestScore, bestLag, scores, lo };
}

function centerTemplate(templateEnv) {
    const m = templateEnv.length;
    let mean = 0;
    for (let i = 0; i < m; i++) mean += templateEnv[i];
    mean /= m;
    const centered = new Float64Array(m);
    let variance = 0;
    for (let i = 0; i < m; i++) {
        centered[i] = templateEnv[i] - mean;
        variance += centered[i] * centered[i];
    }
    return { centered, norm: Math.sqrt(variance) };
}

function decimate(env, factor) {
    const out = new Float64Array(Math.floor(env.length / factor));
    for (let i = 0; i < out.length; i++) {
        let acc = 0;
        for (let j = 0; j < factor; j++) acc += env[i * factor + j];
        out[i] = acc / factor;
    }
    return out;
}

// Coarse-to-fine search: long video × long template is billions of multiplies
// at full resolution, so scan 8×-decimated envelopes first, then refine the
// top candidate neighborhoods at full resolution.
function findSegmentOffset(targetEnv, templateEnv) {
    const n = targetEnv.length;
    const m = templateEnv.length;
    if (m < 10 || n < m) return { found: false, score: 0, offsetSeconds: 0 };

    const { centered, norm } = centerTemplate(templateEnv);
    if (norm < 1e-9) return { found: false, score: 0, offsetSeconds: 0 }; // silent template

    const D = 8;
    let candidates = null;
    let refineRadius = 0;
    if (m / D >= 16 && n / D > m / D + 4) {
        const tDec = decimate(targetEnv, D);
        const sDec = decimate(templateEnv, D);
        const { centered: cDec, norm: nDec } = centerTemplate(sDec);
        if (nDec < 1e-9) return { found: false, score: 0, offsetSeconds: 0 };
        const coarse = nccScan(tDec, buildPrefix(tDec), cDec, nDec, sDec.length, 0, tDec.length - sDec.length, true);

        // Top 5 well-separated coarse peaks, each refined at full resolution.
        // The refinement window must cover the whole separation gap: periodic
        // audio produces near-equal peaks one period apart, and the true one
        // may sit just inside a neighbor's exclusion zone.
        const picks = [];
        const taken = [];
        const minGap = Math.max(4, Math.floor(sDec.length / 2));
        refineRadius = minGap * D;
        for (let k = 0; k < 5; k++) {
            let best = -Infinity, bestI = -1;
            for (let i = 0; i < coarse.scores.length; i++) {
                if (coarse.scores[i] <= best) continue;
                if (taken.some(tk => Math.abs(tk - i) < minGap)) continue;
                best = coarse.scores[i];
                bestI = i;
            }
            if (bestI < 0) break;
            taken.push(bestI);
            picks.push(bestI * D);
        }
        candidates = picks;
    }

    // One prefix build covers every full-resolution scan on this target.
    const pre = buildPrefix(targetEnv);
    let best = { bestScore: -Infinity, bestLag: 0 };
    if (candidates) {
        for (const c of candidates) {
            const r = nccScan(targetEnv, pre, centered, norm, m, c - refineRadius, c + refineRadius, false);
            if (r.bestScore > best.bestScore) best = r;
        }
    } else {
        best = nccScan(targetEnv, pre, centered, norm, m, 0, n - m, false);
    }

    // A fully silent target never produces a scorable window — bestScore
    // stays -Infinity, which must not leak to the renderer.
    const score = Number.isFinite(best.bestScore) ? Math.round(best.bestScore * 100) / 100 : 0;
    return {
        found: score >= MATCH_THRESHOLD,
        score,
        offsetSeconds: best.bestLag / FRAMES_PER_SECOND
    };
}

module.exports = { extractEnvelope, findSegmentOffset, MATCH_THRESHOLD, FRAMES_PER_SECOND };
