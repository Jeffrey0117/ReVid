// Whisper speech-to-text pipeline: downloads a whisper.cpp prebuilt binary +
// ggml model once (into userData/whisper), then transcribes videos to .srt
// files saved next to them. Cues stream out live while transcription runs, so
// subtitles can appear in the player before the file is finished.
const { app, net } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ffmpegPath, trackFfmpegProc } = require('./ffmpeg-runner.cjs');
const library = require('./library-file.cjs');
const { parse: srtParse } = require('./srt.cjs');

const RELEASE_TAG = 'v1.9.2';
// Windows-only: these are the only prebuilt CLI archives whisper.cpp ships.
// The macOS asset in the same release is an xcframework (a library to embed in
// an Xcode target), not an executable, so there is nothing to download here.
const BIN_URLS = {
    cuda: `https://github.com/ggml-org/whisper.cpp/releases/download/${RELEASE_TAG}/whisper-cublas-12.4.0-bin-x64.zip`,
    cpu: `https://github.com/ggml-org/whisper.cpp/releases/download/${RELEASE_TAG}/whisper-bin-x64.zip`
};
// A function, not a captured constant: every platform-dependent answer this
// module gives is then read from the same place at the same time, so status
// fields cannot disagree with each other.
const isWin = () => process.platform === 'win32';

// Where a whisper.cpp CLI installed by the user's own package manager lands.
// Checked only off Windows, where ReVid cannot install the engine itself:
// `brew install whisper-cpp` then just works.
const SYSTEM_WHISPER_PATHS = [
    '/opt/homebrew/bin/whisper-cli',   // Homebrew, Apple silicon
    '/usr/local/bin/whisper-cli',      // Homebrew, Intel
    '/opt/homebrew/bin/whisper-cpp',
    '/usr/local/bin/whisper-cpp',
    '/usr/bin/whisper-cli'
];

// REVID_WHISPER_CLI points at a CLI installed somewhere else — a pnpm/nix
// prefix, a self-built binary, or a second machine's mount. Honoured on every
// platform so a Windows user can also substitute their own build.
function findSystemWhisper() {
    const override = process.env.REVID_WHISPER_CLI;
    if (override) {
        try {
            fs.accessSync(override, fs.constants.X_OK);
            return override;
        } catch (e) {
            console.error('[whisper] REVID_WHISPER_CLI is set but not executable:', override);
        }
    }
    if (isWin()) return null;
    for (const p of SYSTEM_WHISPER_PATHS) {
        try {
            fs.accessSync(p, fs.constants.X_OK);
            return p;
        } catch (e) { /* try the next prefix */ }
    }
    return null;
}
const MODEL_URL = (model) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;

const DEFAULT_MODEL = 'medium';

function whisperDir() {
    return path.join(app.getPath('userData'), 'whisper');
}

function modelPath(model) {
    return path.join(whisperDir(), `ggml-${model}.bin`);
}

function binDir(flavor) {
    return path.join(whisperDir(), `bin-${flavor}`);
}

// The zip layouts differ between flavors/releases — find the CLI wherever it
// landed. Newer builds ship whisper-cli.exe; older ones main.exe.
function findWhisperExe(dir) {
    if (!fs.existsSync(dir)) return null;
    const stack = [dir];
    let fallback = null;
    while (stack.length) {
        const d = stack.pop();
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, entry.name);
            if (entry.isDirectory()) { stack.push(p); continue; }
            const name = entry.name.toLowerCase();
            if (name === (isWin() ? 'whisper-cli.exe' : 'whisper-cli')) return p;
            if (name === (isWin() ? 'main.exe' : 'main')) fallback = p;
        }
    }
    return fallback;
}

function getWhisperStatus(model = DEFAULT_MODEL) {
    // Prefer the GPU build; the tiny CPU build is kept as a fallback for
    // machines where the CUDA runtime won't initialise.
    const cudaExe = findWhisperExe(binDir('cuda'));
    const cpuExe = findWhisperExe(binDir('cpu'));
    const systemExe = cudaExe || cpuExe ? null : findSystemWhisper();
    const exePath = cudaExe || cpuExe || systemExe;
    const mPath = modelPath(model);
    const modelReady = fs.existsSync(mPath) && fs.statSync(mPath).size > 10 * 1024 * 1024;
    return {
        binaryReady: Boolean(exePath),
        modelReady,
        exePath,
        fallbackExePath: cudaExe ? cpuExe : null,
        flavor: cudaExe ? 'cuda' : (cpuExe ? 'cpu' : (systemExe ? 'system' : null)),
        model,
        modelPath: mPath,
        // Can ReVid fetch the engine itself? Only on Windows. Elsewhere the
        // caller must tell the user to install it rather than offer a download
        // that cannot succeed.
        installable: isWin(),
        platform: process.platform
    };
}

// Electron's net follows redirects (GitHub → CDN, HF → CDN) automatically.
function downloadFile(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const tmp = dest + '.part';
        const req = net.request(url);
        req.on('response', (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`));
                return;
            }
            const lenHeader = res.headers['content-length'];
            const total = parseInt(Array.isArray(lenHeader) ? lenHeader[0] : (lenHeader || '0'), 10);
            const ws = fs.createWriteStream(tmp);
            let got = 0;
            res.on('data', (chunk) => {
                got += chunk.length;
                ws.write(chunk);
                onProgress?.(got, total);
            });
            res.on('end', () => ws.end(() => {
                try {
                    fs.renameSync(tmp, dest);
                    resolve();
                } catch (e) { reject(e); }
            }));
            res.on('error', (e) => { ws.destroy(); reject(e); });
        });
        req.on('error', reject);
        req.end();
    });
}

function run(cmd, args) {
    return new Promise((resolve) => {
        const proc = spawn(cmd, args);
        let err = '';
        proc.stderr.on('data', (d) => { err = (err + d.toString()).slice(-512); });
        proc.on('error', (e) => resolve({ code: -1, err: e.message }));
        proc.on('close', (code) => resolve({ code, err }));
    });
}

async function extractZip(zipPath, destDir) {
    fs.mkdirSync(destDir, { recursive: true });

    // Windows ships bsdtar at System32; call it by full path because a Git
    // Bash GNU tar earlier on PATH treats "C:\..." as a remote host spec.
    const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(sysTar)) {
        const r = await run(sysTar, ['-xf', zipPath, '-C', destDir]);
        if (r.code === 0) return;
    }

    // Fallback: .NET ZipFile via PowerShell (works on older Windows too).
    const ps = [
        '-NoProfile', '-NonInteractive', '-Command',
        `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
        `[System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath.replace(/'/g, "''")}','${destDir.replace(/'/g, "''")}')`
    ];
    const r2 = await run('powershell.exe', ps);
    if (r2.code !== 0) {
        throw new Error(`unzip failed: ${r2.err || `exit ${r2.code}`}`);
    }
}

// Download binary (flavor) and model as needed. sendProgress gets
// { stage: 'binary'|'model', pct, got, total }.
async function ensureWhisper({ flavor = 'cuda', model = DEFAULT_MODEL }, sendProgress) {
    let status = getWhisperStatus(model);

    const fetchFlavor = async (f, stage) => {
        if (findWhisperExe(binDir(f))) return;
        const zipPath = path.join(whisperDir(), `whisper-${f}.zip`);
        await downloadFile(BIN_URLS[f], zipPath, (got, total) => {
            sendProgress?.({ stage, pct: total ? Math.round((got / total) * 100) : 0, got, total });
        });
        await extractZip(zipPath, binDir(f));
        try { fs.unlinkSync(zipPath); } catch (e) { /* keep zip */ }
    };

    if (isWin()) {
        // The CPU build is 8MB and always runs — fetch it first so there is a
        // working fallback even if the CUDA runtime turns out to be unusable.
        await fetchFlavor('cpu', 'binary');
        if (flavor === 'cuda') await fetchFlavor('cuda', 'binary');
    } else if (!status.binaryReady) {
        // No prebuilt CLI exists for this platform, so there is nothing to
        // download. The model below is portable, but without an engine to run
        // it there is no point starting the transfer.
        throw new Error(
            'Automatic transcription needs a whisper.cpp CLI, which ReVid can only '
            + `install on Windows. On ${process.platform === 'darwin' ? 'macOS' : 'this system'}, `
            + 'install it yourself (macOS: brew install whisper-cpp) and ReVid will pick it up. '
            + 'Subtitles made on another machine still play normally.'
        );
    }

    status = getWhisperStatus(model);
    if (!status.binaryReady) throw new Error('whisper binary not found after extraction');

    if (!status.modelReady) {
        await downloadFile(MODEL_URL(model), modelPath(model), (got, total) => {
            sendProgress?.({ stage: 'model', pct: total ? Math.round((got / total) * 100) : 0, got, total });
        });
        status = getWhisperStatus(model);
        if (!status.modelReady) throw new Error('model download incomplete');
    }

    return status;
}

// Best-effort: a restricted account may refuse, and losing the nudge only
// costs some smoothness, so never let it take the job down.
function deprioritise(proc) {
    if (!proc?.pid) return;
    try {
        os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch (e) { /* not permitted here */ }
}

const CUE_RE = /^\[(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\]\s*(.*)$/;

function cueTime(h, m, s, ms) {
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

// Transcribe one video to <video>.srt (saved beside it). Streams live cues via
// onCue and percentage via onProgress. Both the wav extraction and the whisper
// process are tracked under the given op so cancel-ffmpeg can kill them.
// whisper-cli receives argv as ANSI on Windows, so any non-ASCII path is
// mangled: it exits 0 and silently writes nothing. Everything handed to it
// must therefore live at an ASCII path. Node's own fs handles Unicode fine,
// so the result is moved to the real (possibly CJK) filename afterwards.
const isAscii = (s) => /^[\x20-\x7E]*$/.test(s);

function asciiWorkDir() {
    const tmp = os.tmpdir();
    if (isAscii(tmp)) return tmp;
    // Non-ASCII username: fall back to a root-level directory.
    const root = path.parse(process.execPath).root;
    const dir = path.join(root, 'revid-whisper-tmp');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

const TEMP_PREFIX = 'revid-whisper-';

// Fallback store for when the video's own folder can't be written to
// (read-only media, a network share, permissions). Subtitles belong next to
// the video so other players can use them, but they must never be lost just
// because that write failed — a lost .srt means re-transcribing from scratch.
function subtitleCacheDir() {
    const dir = path.join(app.getPath('userData'), 'subtitle-cache');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// Stable per-file key: full path + size, so a moved or replaced file misses.
function subtitleCacheKey(videoPath) {
    let size = 0;
    try { size = fs.statSync(videoPath).size; } catch (e) { /* gone */ }
    let h = 0;
    const s = `${path.resolve(videoPath).toLowerCase()}:${size}`;
    for (let i = 0; i < s.length; i++) {
        h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return `${(h >>> 0).toString(36)}-${size}`;
}

function cachedSubtitlePath(videoPath, suffix = '.srt') {
    return path.join(subtitleCacheDir(), `${subtitleCacheKey(videoPath)}${suffix}`);
}

// Windows won't unlink a file a just-killed process still holds open, so the
// delete is retried briefly. An abandoned wav is ~2MB per minute of video.
async function removeWithRetry(filePath) {
    for (let i = 0; i < 6; i++) {
        try {
            await fs.promises.unlink(filePath);
            return true;
        } catch (e) {
            if (e.code === 'ENOENT') return true;
            await new Promise((r) => setTimeout(r, 250));
        }
    }
    return false;
}

// Sweep temp files left behind by a crash or a kill that lost the race.
function cleanupWhisperTemp() {
    for (const dir of new Set([os.tmpdir(), asciiWorkDir()])) {
        let entries;
        try { entries = fs.readdirSync(dir); } catch (e) { continue; }
        for (const name of entries) {
            if (!name.startsWith(TEMP_PREFIX)) continue;
            try { fs.unlinkSync(path.join(dir, name)); } catch (e) { /* in use */ }
        }
    }
}

// ffmpeg writes the extracted wav starting at sample zero, dropping any
// container start offset. Whisper timestamps are therefore relative to the
// first audio sample, while the player seeks on the container timeline — so
// subtitles land early by exactly that offset on files that have one.
function probeStartTime(videoPath) {
    return new Promise((resolve) => {
        const proc = spawn(ffmpegPath, ['-hide_banner', '-i', videoPath]);
        let err = '';
        proc.stderr.on('data', (d) => { err += d.toString(); });
        proc.on('error', () => resolve(0));
        proc.on('close', () => {
            const m = err.match(/Duration:[^,]+,\s*start:\s*(-?[\d.]+)/);
            const start = m ? parseFloat(m[1]) : 0;
            resolve(Number.isFinite(start) ? start : 0);
        });
    });
}

const SRT_TIME = /(\d{2}):(\d{2}):(\d{2}),(\d{3})/g;

function shiftSrt(content, seconds) {
    if (!seconds) return content;
    return content.replace(SRT_TIME, (_m, h, m, s, ms) => {
        const t = Math.max(0, (+h * 3600 + +m * 60 + +s + +ms / 1000) + seconds);
        const hh = String(Math.floor(t / 3600)).padStart(2, '0');
        const mm = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
        const ss = String(Math.floor(t % 60)).padStart(2, '0');
        const mmm = String(Math.round((t - Math.floor(t)) * 1000)).padStart(3, '0');
        return `${hh}:${mm}:${ss},${mmm}`;
    });
}

async function transcribeVideo({ videoPath, exePath, fallbackExePath, modelPath: mPath, op = 'whisper' }, { onCue, onProgress } = {}) {
    const workDir = asciiWorkDir();
    const stamp = `${Date.now()}-${Math.floor(process.hrtime()[1] / 1000)}`;
    const wavPath = path.join(workDir, `revid-whisper-${stamp}.wav`);
    // whisper writes <outBase>.srt; kept ASCII, then read back and stored.
    const outBase = path.join(workDir, `revid-whisper-${stamp}`);
    const tmpSrtPath = `${outBase}.srt`;

    // 1. Extract 16kHz mono wav (whisper's expected input).
    const ffOk = await new Promise((resolve) => {
        const proc = spawn(ffmpegPath, [
            '-y', '-v', 'error', '-i', videoPath,
            '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', wavPath
        ]);
        trackFfmpegProc(op, proc);
        proc.on('error', () => resolve(false));
        proc.on('close', (code) => resolve(code === 0));
    });
    if (!ffOk || !fs.existsSync(wavPath)) {
        await removeWithRetry(wavPath);
        return { success: false, error: 'No decodable audio track' };
    }

    // 2. Run whisper. -osrt writes <of>.srt; stdout prints timed segments as
    // they are decoded (live cues); -pp prints progress on stderr.
    // It takes every thread it is handed and runs for minutes, so it must
    // never out-rank the video being watched — below-normal still gets all
    // the idle cycles, it just yields the moment the foreground wants them.
    const threads = Math.max(2, Math.min(8, os.cpus().length - 2));
    const runWhisper = (exe) => new Promise((resolve) => {
        const proc = spawn(exe, [
            '-m', mPath,
            '-f', wavPath,
            '-l', 'auto',
            '-t', String(threads),
            '-osrt', '-of', outBase,
            '-pp'
        ], { cwd: path.dirname(exe) });
        trackFfmpegProc(op, proc);
        deprioritise(proc);

        let stdoutBuf = '';
        proc.stdout.on('data', (d) => {
            stdoutBuf += d.toString();
            const lines = stdoutBuf.split('\n');
            stdoutBuf = lines.pop();
            for (const line of lines) {
                const m = line.trim().match(CUE_RE);
                if (m && m[9] !== undefined) {
                    onCue?.({
                        start: cueTime(m[1], m[2], m[3], m[4]),
                        end: cueTime(m[5], m[6], m[7], m[8]),
                        text: m[9].trim()
                    });
                }
            }
        });
        let stderrTail = '';
        proc.stderr.on('data', (d) => {
            const text = d.toString();
            stderrTail = (stderrTail + text).slice(-2048);
            const m = text.match(/progress\s*=\s*(\d+)%/);
            if (m) onProgress?.(Math.min(100, parseInt(m[1], 10)));
        });
        proc.on('error', (e) => resolve({ code: -1, error: e.message, stderrTail }));
        proc.on('close', (code) => resolve({ code, stderrTail }));
    });

    let result = await runWhisper(exePath);
    // A GPU build can download fine and still fail to initialise CUDA on this
    // machine — fall back to the CPU build rather than leaving the user stuck.
    if (result.code !== 0 && fallbackExePath && fallbackExePath !== exePath) {
        onProgress?.(0);
        result = await runWhisper(fallbackExePath);
    }

    await removeWithRetry(wavPath);

    if (result.code !== 0) {
        await removeWithRetry(tmpSrtPath);
        const lastLine = (result.stderrTail || '').trim().split('\n').filter(Boolean).pop() || '';
        return { success: false, error: result.error || `whisper exited with code ${result.code}: ${lastLine}` };
    }
    if (!fs.existsSync(tmpSrtPath)) {
        return { success: false, error: 'whisper produced no subtitle file' };
    }

    // Put the cues back on the container timeline before saving.
    let srtText;
    try {
        srtText = await fs.promises.readFile(tmpSrtPath, 'utf8');
    } catch (e) {
        return { success: false, error: `Could not read subtitles: ${e.message}` };
    }
    const startOffset = await probeStartTime(videoPath);
    if (startOffset) srtText = shiftSrt(srtText, startOffset);
    await removeWithRetry(tmpSrtPath);

    // Subtitles go into the folder's library file rather than a sidecar, so a
    // folder gains one file instead of two per video. If that folder cannot
    // be written, keep the work in the cache rather than discarding a
    // finished run.
    const cues = srtParse(srtText);
    const saved = library.setSubtitles(videoPath, cues);
    if (saved.success) return { success: true, cues, startOffset, savedTo: saved.path };

    try {
        await fs.promises.writeFile(cachedSubtitlePath(videoPath, '.srt'), srtText, 'utf8');
        return { success: true, cues, cached: true, startOffset, saveError: saved.error };
    } catch (e2) {
        return { success: false, error: `Could not save subtitles: ${saved.error}` };
    }
}

module.exports = {
    DEFAULT_MODEL,
    getWhisperStatus,
    ensureWhisper,
    transcribeVideo,
    cleanupWhisperTemp,
    cachedSubtitlePath,
    // exported for tests
    findWhisperExe,
    findSystemWhisper,
    downloadFile,
    extractZip
};
