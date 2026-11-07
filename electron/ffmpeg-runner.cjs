// Shared ffmpeg job runner. Every spawned ffmpeg process is tracked per
// operation so the renderer can cancel it (closing a dialog mid-encode)
// and quit kills stragglers instead of leaving orphaned encoders.
const { app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');

// ffmpeg-static resolves to a path inside app.asar when packaged, but a binary can't be
// spawned from inside the asar archive. asarUnpack ships it to app.asar.unpacked, so
// rewrite the path for the packaged app — otherwise every ffmpeg op silently fails.
const ffmpegStatic = require('ffmpeg-static');
const ffmpegPath = app.isPackaged
    ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
    : ffmpegStatic;

const activeFfmpegJobs = new Map(); // op -> Set<ChildProcess>
const cancelledFfmpegProcs = new WeakSet();
// Bumped on every cancel so multi-step handlers (probe → encode → retry) can
// notice a cancel that arrived while no process was alive to kill.
const cancelEpochs = new Map(); // op -> number

// Where progress percentages are sent. main.cjs points this at the main
// window once it exists.
let getProgressWindow = () => null;

function setFfmpegProgressWindowGetter(fn) {
    getProgressWindow = fn;
}

function trackFfmpegProc(op, proc) {
    let jobs = activeFfmpegJobs.get(op);
    if (!jobs) {
        jobs = new Set();
        activeFfmpegJobs.set(op, jobs);
    }
    jobs.add(proc);
    proc.on('close', () => jobs.delete(proc));
    proc.on('error', () => jobs.delete(proc));
}

function isCancelledFfmpegProc(proc) {
    return cancelledFfmpegProcs.has(proc);
}

function cancelFfmpegJobs(op) {
    cancelEpochs.set(op, (cancelEpochs.get(op) || 0) + 1);
    const jobs = activeFfmpegJobs.get(op);
    if (!jobs) return 0;
    let count = 0;
    for (const proc of [...jobs]) {
        cancelledFfmpegProcs.add(proc);
        try {
            proc.kill();
            count += 1;
        } catch (e) {
            // process already exited
        }
    }
    return count;
}

function killAllFfmpegJobs() {
    for (const op of activeFfmpegJobs.keys()) cancelFfmpegJobs(op);
}

function getCancelEpoch(op) {
    return cancelEpochs.get(op) || 0;
}

// Runs ffmpeg with uniform '-progress pipe:1' percentage reporting.
// Progress lines are buffered so a value split across stdout chunks isn't
// dropped. Resolves { code, cancelled, error? } — the caller shapes the
// IPC result from that.
function runFfmpeg({ op, args, progressChannel, totalUs }) {
    return new Promise((resolve) => {
        const proc = spawn(ffmpegPath, args);
        trackFfmpegProc(op, proc);

        let buffered = '';
        proc.stdout.on('data', (data) => {
            buffered += data.toString();
            const lines = buffered.split('\n');
            buffered = lines.pop();
            for (const line of lines) {
                const match = line.match(/out_time_us=(\d+)/);
                const win = getProgressWindow();
                if (match && progressChannel && totalUs > 0 && win && !win.isDestroyed()) {
                    const pct = Math.min(100, Math.round((parseInt(match[1], 10) / totalUs) * 100));
                    win.webContents.send(progressChannel, pct);
                }
            }
        });
        // Keep the tail of stderr so a non-zero exit can report WHY ffmpeg
        // failed ("width not divisible by 2", bad codec for container, …).
        let stderrTail = '';
        proc.stderr.on('data', (data) => {
            stderrTail = (stderrTail + data.toString()).slice(-2048);
        });

        proc.on('close', (code) => {
            resolve({ code, cancelled: cancelledFfmpegProcs.has(proc), stderrTail });
        });
        proc.on('error', (err) => {
            resolve({ code: -1, cancelled: cancelledFfmpegProcs.has(proc), error: err.message, stderrTail });
        });
    });
}

// Hardware H.264 encoder detection. ffmpeg-static compiles in nvenc/qsv/amf,
// but whether they actually work depends on this machine's GPU and drivers —
// the only reliable test is a tiny real encode. Detected once, then cached.
const HW_H264_CANDIDATES = ['h264_nvenc', 'h264_qsv', 'h264_amf'];
let h264EncoderPromise = null;

function probeEncoder(name) {
    return new Promise((resolve) => {
        const proc = spawn(ffmpegPath, [
            '-hide_banner', '-v', 'error',
            '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.1',
            '-c:v', name, '-f', 'null', '-'
        ]);
        // Track like any job so quit-time killAllFfmpegJobs reaps a hung probe.
        trackFfmpegProc('encoder-probe', proc);
        const timer = setTimeout(() => {
            try { proc.kill(); } catch (e) { /* already exited */ }
        }, 5000);
        timer.unref();
        proc.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
        proc.on('error', () => { clearTimeout(timer); resolve(false); });
    });
}

function getH264Encoder() {
    if (!h264EncoderPromise) {
        h264EncoderPromise = (async () => {
            for (const name of HW_H264_CANDIDATES) {
                if (await probeEncoder(name)) return name;
            }
            return 'libx264';
        })();
    }
    return h264EncoderPromise;
}

function fileSizeOrZero(p) {
    try {
        return fs.statSync(p).size;
    } catch (e) {
        return 0;
    }
}

// Maps a runFfmpeg result to a failure IPC payload, or null on success.
function ffmpegFailure(r) {
    if (r.cancelled) return { success: false, cancelled: true, error: 'Cancelled' };
    if (r.error) return { success: false, error: r.error };
    if (r.code !== 0) {
        const lastLine = (r.stderrTail || '').trim().split('\n').filter(Boolean).pop();
        return {
            success: false,
            error: lastLine
                ? `ffmpeg exited with code ${r.code}: ${lastLine.trim()}`
                : `ffmpeg exited with code ${r.code}`
        };
    }
    return null;
}

module.exports = {
    ffmpegPath,
    setFfmpegProgressWindowGetter,
    trackFfmpegProc,
    isCancelledFfmpegProc,
    cancelFfmpegJobs,
    killAllFfmpegJobs,
    getCancelEpoch,
    getH264Encoder,
    runFfmpeg,
    fileSizeOrZero,
    ffmpegFailure
};
