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
        proc.stderr.on('data', () => {});

        proc.on('close', (code) => {
            resolve({ code, cancelled: cancelledFfmpegProcs.has(proc) });
        });
        proc.on('error', (err) => {
            resolve({ code: -1, cancelled: cancelledFfmpegProcs.has(proc), error: err.message });
        });
    });
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
    if (r.code !== 0) return { success: false, error: `ffmpeg exited with code ${r.code}` };
    return null;
}

module.exports = {
    ffmpegPath,
    setFfmpegProgressWindowGetter,
    trackFfmpegProc,
    isCancelledFfmpegProc,
    cancelFfmpegJobs,
    killAllFfmpegJobs,
    runFfmpeg,
    fileSizeOrZero,
    ffmpegFailure
};
