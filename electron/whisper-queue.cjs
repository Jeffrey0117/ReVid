// Serial transcription queue. Whisper saturates the GPU/CPU, so exactly one
// job runs at a time; everything else waits. The video the user is actually
// watching jumps ahead of the folder sweep.
const fs = require('fs');
const path = require('path');

const PRIORITY = { HIGH: 0, LOW: 1 };

function createWhisperQueue({ runJob, hasSubtitles, onEvent }) {
    const queue = [];          // { videoPath, priority, resolve, reject }
    const queued = new Set();  // videoPath — avoid duplicates
    let running = null;        // videoPath currently transcribing
    let cancelledAll = false;

    const emit = (payload) => {
        try { onEvent?.({ ...payload, pending: queue.length, running }); } catch (e) { /* no listener */ }
    };

    function enqueue(videoPath, priority = PRIORITY.LOW) {
        // Already transcribed, in flight, or waiting — nothing to do.
        if (running === videoPath) return null;
        if (queued.has(videoPath)) {
            const existing = queue.find(j => j.videoPath === videoPath);
            // A low-priority job that the user now wants immediately.
            if (existing && priority < existing.priority) {
                existing.priority = priority;
                queue.sort((a, b) => a.priority - b.priority);
            }
            return existing ? existing.promise : null;
        }

        let resolve;
        const promise = new Promise((r) => { resolve = r; });
        const job = { videoPath, priority, resolve, promise };
        queue.push(job);
        queued.add(videoPath);
        queue.sort((a, b) => a.priority - b.priority);
        emit({ type: 'queued', videoPath });
        pump();
        return promise;
    }

    async function pump() {
        if (running || queue.length === 0) return;
        const job = queue.shift();
        queued.delete(job.videoPath);

        if (cancelledAll) {
            job.resolve({ success: false, cancelled: true });
            return pump();
        }
        // The file may have gained subtitles while it sat in the queue.
        if (!fs.existsSync(job.videoPath) || hasSubtitles(job.videoPath)) {
            job.resolve({ success: true, skipped: true });
            emit({ type: 'skipped', videoPath: job.videoPath });
            return pump();
        }

        running = job.videoPath;
        emit({ type: 'start', videoPath: job.videoPath });
        let result;
        try {
            result = await runJob(job.videoPath);
        } catch (e) {
            result = { success: false, error: e.message };
        }
        running = null;
        emit({ type: 'done', videoPath: job.videoPath, result });
        job.resolve(result);
        pump();
    }

    // Drop everything waiting; the in-flight job is stopped by its own op.
    function clearPending() {
        for (const job of queue) job.resolve({ success: false, cancelled: true });
        queue.length = 0;
        queued.clear();
        emit({ type: 'cleared' });
    }

    function enqueueFolder(videoPaths) {
        let added = 0;
        for (const p of videoPaths) {
            if (hasSubtitles(p)) continue;
            if (enqueue(p, PRIORITY.LOW) !== null) added += 1;
        }
        return added;
    }

    return {
        enqueue,
        enqueueFolder,
        clearPending,
        status: () => ({ running, pending: queue.length }),
        setCancelledAll: (v) => { cancelledAll = v; },
        PRIORITY
    };
}

module.exports = { createWhisperQueue, PRIORITY };
