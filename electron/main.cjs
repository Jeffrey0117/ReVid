const { app, BrowserWindow, Menu, ipcMain, dialog, protocol, shell, net } = require('electron');
const createFamily = require('family-kit');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const {
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
} = require('./ffmpeg-runner.cjs');
const { extractEnvelope, findSegmentOffset, FRAMES_PER_SECOND } = require('./segment-matcher.cjs');
const {
    getWhisperStatus, ensureWhisper, transcribeVideo, cleanupWhisperTemp,
    cachedSubtitlePath, DEFAULT_MODEL
} = require('./whisper-runner.cjs');
const { translateLines } = require('./translator.cjs');
const { createWhisperQueue } = require('./whisper-queue.cjs');
const pluginHost = require('./plugin-host.cjs');
const dictionary = require('./dictionary.cjs');
const lanServer = require('./lan-server.cjs');
const { registerTheaterStore, drainTheaterSaves } = require('./theater-store.cjs');
const { registerSyncClient, drainSyncRequests } = require('./sync-client.cjs');
const { registerLocalVideoProtocol } = require('./local-video-protocol.cjs');

// Auto-update (packaged builds only): check GitHub Releases on launch, download in the
// background, install on next quit. Install once per machine, then updates land for free.
function setupAutoUpdater() {
    if (!app.isPackaged) return;
    let autoUpdater;
    try {
        ({ autoUpdater } = require('electron-updater'));
    } catch (e) {
        console.error('[updater] electron-updater unavailable:', e.message);
        return;
    }
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', (err) => console.error('[updater] error:', err?.message || err));
    autoUpdater.on('update-available', (info) => console.log('[updater] update available:', info?.version));
    autoUpdater.on('update-downloaded', (info) => console.log('[updater] downloaded; install on quit:', info?.version));
    // Defer the network check so it doesn't compete with first paint / playback.
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch((e) => console.error('[updater] check failed:', e?.message || e));
    }, 6000);
}

// Register local-video:// protocol for range-request support
protocol.registerSchemesAsPrivileged([
    { scheme: 'local-video', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true } }
]);

let mainWindow = null;
let miniPlayerWindow = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Swap a freshly encoded temp file in over the original. Windows refuses to
// rename a file that is still open (the viewer may hold a handle briefly),
// so renames retry before giving up. The original survives every failure
// path: it is only removed after the new file is verifiably in place.
//
// The temp is always an MP4; a non-mp4 original therefore gets a NEW name
// (<base>.mp4) and the old file is deleted — renaming MP4 bytes onto a
// .mkv/.webm path would corrupt the library. Returns { newPath } so the
// renderer can follow the file.
async function replaceOriginalFile(tempPath, originalPath) {
    // Never swap in a suspiciously tiny output: ffmpeg can exit 0 with an
    // empty file (disk full at close, killed-but-reaped child).
    if (fileSizeOrZero(tempPath) < 1024) {
        try { await fs.promises.unlink(tempPath); } catch (e) { /* none written */ }
        return { success: false, error: 'Encoded file is empty — original left untouched' };
    }

    const ext = path.extname(originalPath).toLowerCase();
    const finalPath = ext === '.mp4'
        ? originalPath
        : originalPath.slice(0, originalPath.length - ext.length) + '.mp4';

    if (finalPath !== originalPath) {
        // Container change: place the new .mp4 beside the original, then
        // remove the original. Both files existing briefly is safe.
        if (fs.existsSync(finalPath)) {
            try { await fs.promises.unlink(tempPath); } catch (e) { /* keep */ }
            return { success: false, error: `${path.basename(finalPath)} already exists` };
        }
        try {
            await fs.promises.rename(tempPath, finalPath);
        } catch (e) {
            return { success: false, error: e.message };
        }
        for (let i = 0; i < 10; i++) {
            try { await fs.promises.unlink(originalPath); break; } catch (e) { await sleep(300); }
        }
        return { success: true, newPath: finalPath };
    }

    const backupPath = finalPath + '.revid-bak';
    let lastErr = null;
    for (let i = 0; i < 10; i++) {
        try {
            await fs.promises.rename(finalPath, backupPath);
            lastErr = null;
            break;
        } catch (e) {
            lastErr = e;
            await sleep(300);
        }
    }
    if (lastErr) {
        try { await fs.promises.unlink(tempPath); } catch (e) { /* keep temp as evidence */ }
        return { success: false, error: `Original file is in use: ${lastErr.message}` };
    }
    try {
        await fs.promises.rename(tempPath, finalPath);
    } catch (e) {
        try {
            await fs.promises.rename(backupPath, finalPath);
        } catch (e2) {
            return { success: false, error: `Replace failed; your original is saved as ${backupPath}` };
        }
        return { success: false, error: e.message };
    }
    try { await fs.promises.unlink(backupPath); } catch (e) { /* stray .revid-bak */ }
    return { success: true, newPath: finalPath };
}

// Per-encoder quality flags roughly matching libx264 crf 18.
const H264_ENCODE_ARGS = {
    libx264: ['-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'],
    h264_nvenc: ['-rc', 'vbr', '-cq', '19', '-b:v', '0', '-preset', 'p4', '-pix_fmt', 'yuv420p'],
    h264_qsv: ['-global_quality', '19', '-pix_fmt', 'nv12'],
    h264_amf: ['-rc', 'cqp', '-qp_i', '19', '-qp_p', '19', '-pix_fmt', 'yuv420p']
};

// ffmpeg progress percentages go to the main window
setFfmpegProgressWindowGetter(() => mainWindow);

// Origin the renderer is served from. Dev uses the Vite server; packaged builds
// serve dist/ over a loopback HTTP server (see startRendererServer) instead of
// file://. A real http://localhost origin is required for the YouTube IFrame
// API — from file:// the embed origin is "null" and YouTube errors (code 153).
let rendererBaseUrl = null;

const STATIC_MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
    '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.ttf': 'font/ttf', '.map': 'application/json'
};

// Serve the built renderer (dist/) from 127.0.0.1 on a FIXED port so the origin
// — and therefore localStorage (last folder, pins, speed…) — stays stable across
// launches. Falls back to the next few ports only if one is already taken.
function startRendererServer() {
    const http = require('http');
    const root = path.join(__dirname, '../dist');
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            try {
                const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
                let filePath = path.normalize(path.join(root, urlPath === '/' ? 'index.html' : urlPath));
                if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
                if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
                    filePath = path.join(root, 'index.html'); // SPA fallback
                }
                res.writeHead(200, { 'Content-Type': STATIC_MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
                fs.createReadStream(filePath).pipe(res);
            } catch {
                res.writeHead(500); res.end();
            }
        });
        const tryListen = (port, attemptsLeft) => {
            server.once('error', (err) => {
                if (err.code === 'EADDRINUSE' && attemptsLeft > 0) tryListen(port + 1, attemptsLeft - 1);
                else reject(err);
            });
            server.listen(port, '127.0.0.1', () => {
                resolve(`http://localhost:${server.address().port}`);
            });
        };
        tryListen(31847, 9);
    });
}

// Remember the window size/position across launches. A bigger viewer area also
// means video is scaled less, so it looks sharper in windowed mode.
const getWindowStatePath = () => path.join(app.getPath('userData'), 'window-state.json');

const loadWindowState = () => {
    try { return JSON.parse(fs.readFileSync(getWindowStatePath(), 'utf-8')); } catch { return null; }
};

// Set when the window is shrunk to the floating music mini-panel, so we can
// restore the real size and never persist the tiny bounds.
let savedMusicBounds = null;
// Whether the window was maximized before entering the mini-panel, so leaving
// it re-maximizes instead of restoring the maximized size as a normal window.
let savedMusicMaximized = false;
// Whether the window is currently in the mini-panel layout. Guards the restore
// so calling set-music-mini(false) when already normal is a harmless no-op.
let isMusicMini = false;
// The user's own "pin on top" choice (toolbar button). Kept separate from the
// mini-panel's forced on-top so leaving the mini-panel restores it, and
// persisted in window-state.json so it survives restarts.
let userAlwaysOnTop = false;

const saveWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
        const b = savedMusicBounds || mainWindow.getNormalBounds();
        const isMaximized = savedMusicBounds ? savedMusicMaximized : mainWindow.isMaximized();
        fs.writeFileSync(getWindowStatePath(), JSON.stringify({ ...b, isMaximized, alwaysOnTop: userAlwaysOnTop }));
    } catch {}
};

// Save shortly after the user stops resizing/moving, not only on close — a
// close that skips the 'close' event (crash, kill, updater) would lose it.
let saveWindowStateTimer = null;
const scheduleSaveWindowState = () => {
    if (isMusicMini) return; // never persist the tiny mini-panel bounds
    clearTimeout(saveWindowStateTimer);
    saveWindowStateTimer = setTimeout(saveWindowState, 500);
};

// Keep a restored (non-maximized) window within the display it lands on, so a
// stale full-screen-sized state never comes back as an oversized window.
const fitToWorkArea = (saved) => {
    if (!saved?.width || !saved?.height) return null;
    try {
        const { screen } = require('electron');
        const hasPos = Number.isFinite(saved.x) && Number.isFinite(saved.y);
        const wa = (hasPos ? screen.getDisplayMatching(saved) : screen.getPrimaryDisplay()).workArea;
        const width = Math.min(saved.width, Math.round(wa.width * 0.9));
        const height = Math.min(saved.height, Math.round(wa.height * 0.9));
        const fits = hasPos && saved.x >= wa.x && saved.y >= wa.y
            && saved.x + width <= wa.x + wa.width && saved.y + height <= wa.y + wa.height;
        return fits
            ? { x: saved.x, y: saved.y, width, height }
            : { x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2), width, height };
    } catch {
        return null;
    }
};

function createWindow() {
    const saved = loadWindowState();
    const bounds = fitToWorkArea(saved);

    // If launched to open a video ("Open with ReVid"), hand the path to the
    // renderer up-front via preload argv so it boots straight into the player —
    // no flash of the grid UI before the video appears.
    const launchFile = app._pendingOpenFile || findOpenableFileInArgs(process.argv);
    const launchVideo = (launchFile && isVideoFile(launchFile)) ? launchFile : null;

    mainWindow = new BrowserWindow({
        width: bounds?.width || 1280,
        height: bounds?.height || 820,
        x: bounds?.x,
        y: bounds?.y,
        minWidth: 640,
        minHeight: 480,
        title: 'ReVid',
        show: false,
        frame: false,
        backgroundColor: '#000000',
        icon: path.join(__dirname, '../revid.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            additionalArguments: [
                // Lets preload find the subtitle cache without an IPC round-trip.
                `--revid-userdata=${app.getPath('userData')}`,
                ...(launchVideo ? [`--revid-open=${launchVideo}`] : [])
            ],
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            webSecurity: false,
            webviewTag: true
        }
    });

    // The renderer opens it from argv, so don't also push it over IPC.
    if (launchVideo) initialFileHandled = true;

    // Re-apply the bounds: at fractional display scaling (e.g. 125%) the
    // constructor rounds the size up, so the window would grow every launch.
    if (bounds) mainWindow.setBounds(bounds);
    if (saved?.isMaximized) mainWindow.maximize();
    userAlwaysOnTop = !!saved?.alwaysOnTop;
    if (userAlwaysOnTop) mainWindow.setAlwaysOnTop(true);

    Menu.setApplicationMenu(null);

    const isDev = !app.isPackaged;
    mainWindow.loadURL(rendererBaseUrl);
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }

    // Never let the app's top frame navigate away from itself — e.g. when a URL
    // is dragged into the window, keep the app loaded instead of browsing to it.
    mainWindow.webContents.on('will-navigate', (e, navUrl) => {
        if (rendererBaseUrl && !navUrl.startsWith(rendererBaseUrl)) e.preventDefault();
    });

    // Show only once the first frame is painted — avoids the black window →
    // UI-repaint flash users see on cold start.
    mainWindow.once('ready-to-show', () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    });
    setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
    }, 2000);

    mainWindow.on('close', saveWindowState);
    for (const evt of ['resize', 'move', 'maximize', 'unmaximize']) {
        mainWindow.on(evt, scheduleSaveWindowState);
    }
}

// Theater persistence, ffmpeg job running and the local-video:// protocol
// live in their own modules: theater-store.cjs, ffmpeg-runner.cjs,
// local-video-protocol.cjs.

function setupIpcHandlers() {
    // 鴨鴨家族（family-kit）：偵測/一鍵安裝同一家的其他 app；IPC 只信任主視窗
    try {
        const family = createFamily({
            selfId: 'revid',
            cacheDir: path.join(app.getPath('userData'), 'family-kit'),
            shell,
            fetch: (url, init) => net.fetch(url, init),
            userAgent: `ReVid/${app.getVersion()}`,
            log: (...a) => console.warn('[family]', ...a),
        });
        family.registerIpc(ipcMain, {
            prefix: 'family',
            isTrusted: (sender) => !!mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents,
        });
    } catch (e) {
        console.warn('[family] init failed:', e.message);
    }

    // Renderer signals it has mounted and wired its IPC listeners — open the
    // launch file immediately (no fixed delay) instead of guessing with a timer.
    ipcMain.on('renderer-ready', (e) => {
        if (mainWindow && !mainWindow.isDestroyed() && e.sender === mainWindow.webContents) {
            flushInitialFile();
        }
    });

    // Fetch a YouTube video's real title via oEmbed (for music-album song names).
    ipcMain.handle('fetch-youtube-title', async (_event, url) => {
        if (!url) return { success: false };
        try {
            const https = require('https');
            const api = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
            const body = await new Promise((resolve, reject) => {
                const req = https.get(api, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
                    if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
                    const chunks = [];
                    res.on('data', (c) => chunks.push(c));
                    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
                });
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            });
            return { success: true, title: JSON.parse(body).title || '' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Theater data persistence (load-theater-data / save-theater-data)
    registerTheaterStore();

    // Cloud sync transport + sync-state.json (sync-request / load / save-sync-state)
    registerSyncClient();

    // Batched file stats for sorting — replaces per-file synchronous stat calls.
    // Chunked so a huge folder doesn't burst thousands of concurrent handles.
    ipcMain.handle('get-file-stats', async (_event, filePaths) => {
        if (!Array.isArray(filePaths)) return { success: false, error: 'Expected an array of paths' };
        const stats = {};
        const CHUNK = 100;
        for (let i = 0; i < filePaths.length; i += CHUNK) {
            await Promise.all(filePaths.slice(i, i + CHUNK).map(async (p) => {
                try {
                    const s = await fs.promises.stat(p);
                    stats[p] = { size: s.size, mtimeMs: s.mtimeMs };
                } catch (e) {
                    stats[p] = { size: 0, mtimeMs: 0 };
                }
            }));
        }
        return { success: true, stats };
    });

    // Open file dialog for video
    ipcMain.handle('open-video', async () => {
        if (!mainWindow) return null;
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] }]
        });
        if (result.canceled || !result.filePaths.length) return null;
        return result.filePaths[0];
    });

    // Open directory dialog
    ipcMain.handle('select-directory', async () => {
        if (!mainWindow) return null;
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory']
        });
        if (result.canceled) return null;
        return result.filePaths[0];
    });

    // Show save dialog for video
    ipcMain.handle('show-save-dialog', async (_event, defaultPath) => {
        if (!mainWindow) return { canceled: true };
        return await dialog.showSaveDialog(mainWindow, {
            defaultPath,
            filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
        });
    });

    // Start native file drag
    ipcMain.on('start-drag', (event, filePath) => {
        try {
            event.sender.startDrag({
                file: filePath,
                icon: path.join(__dirname, '../revid.png')
            });
        } catch {}
    });

    // Select output directory
    ipcMain.handle('select-output-directory', async () => {
        if (!mainWindow) return null;
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory', 'createDirectory']
        });
        if (result.canceled) return null;
        return result.filePaths[0];
    });

    // Cancel every running job of one operation (renderer calls this when a
    // tool dialog closes mid-encode).
    ipcMain.handle('cancel-ffmpeg', (_event, op) => {
        return { success: true, cancelled: cancelFfmpegJobs(op) };
    });

    // Extract screenshots from video at intervals
    ipcMain.handle('extract-screenshots', async (_event, params) => {
        const { inputPath, outputDir, interval, format, totalDuration } = params;
        const ext = format === 'png' ? 'png' : 'jpg';
        const baseName = path.basename(inputPath, path.extname(inputPath));
        const outputPattern = path.join(outputDir, `${baseName}_%04d.${ext}`);

        const args = ['-y', '-i', inputPath, '-vf', `fps=1/${interval}`];
        if (ext === 'png') {
            args.push('-compression_level', '3');
        } else {
            args.push('-q:v', '2');
        }
        args.push('-progress', 'pipe:1', outputPattern);

        const startedAt = Date.now() - 2000; // small margin for fs mtime rounding
        const r = await runFfmpeg({
            op: 'extract-screenshots',
            args,
            progressChannel: 'screenshot-progress',
            totalUs: (totalDuration || 1) * 1_000_000
        });

        // Count only files this run produced, not leftovers from earlier runs
        let count = 0;
        try {
            count = fs.readdirSync(outputDir).filter((f) => {
                if (!f.startsWith(baseName + '_') || !f.endsWith(`.${ext}`)) return false;
                try {
                    return fs.statSync(path.join(outputDir, f)).mtimeMs >= startedAt;
                } catch (e) {
                    return false;
                }
            }).length;
        } catch (e) {
            // output dir unreadable — report zero
        }

        const failure = ffmpegFailure(r);
        if (failure) return { ...failure, count };
        return { success: true, count };
    });

    // Create GIF from video segment
    ipcMain.handle('create-gif', async (_event, params) => {
        const { inputPath, outputPath, startTime, duration, fps, width } = params;

        const vf = `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;

        const args = [
            '-y',
            '-ss', String(startTime),
            '-t', String(duration),
            '-i', inputPath,
            '-vf', vf,
            '-loop', '0',
            '-progress', 'pipe:1',
            outputPath
        ];

        const r = await runFfmpeg({
            op: 'create-gif',
            args,
            progressChannel: 'gif-progress',
            totalUs: duration * 1_000_000
        });
        return ffmpegFailure(r) || { success: true, fileSize: fileSizeOrZero(outputPath) };
    });

    // Compress video (re-encode with quality/resolution)
    ipcMain.handle('compress-video', async (_event, params) => {
        const { inputPath, outputPath, crf, resolution, totalDuration } = params;

        const args = ['-y', '-i', inputPath];

        const vf = resolution ? `scale=${resolution}:-2` : null;
        if (vf) args.push('-vf', vf);

        args.push('-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium', '-pix_fmt', 'yuv420p');
        args.push('-c:a', 'aac', '-b:a', '128k');
        args.push('-progress', 'pipe:1');
        args.push(outputPath);

        const r = await runFfmpeg({
            op: 'compress-video',
            args,
            progressChannel: 'compress-progress',
            totalUs: (totalDuration || 1) * 1_000_000
        });
        return ffmpegFailure(r) || { success: true, fileSize: fileSizeOrZero(outputPath) };
    });

    // Extract audio from video
    ipcMain.handle('extract-audio', async (_event, params) => {
        const { inputPath, outputPath, format, totalDuration } = params;

        const args = ['-y', '-i', inputPath, '-vn'];

        if (format === 'mp3') {
            args.push('-c:a', 'libmp3lame', '-q:a', '2');
        } else if (format === 'aac') {
            args.push('-c:a', 'aac', '-b:a', '192k');
        } else {
            args.push('-c:a', 'copy');
        }

        args.push('-progress', 'pipe:1');
        args.push(outputPath);

        const r = await runFfmpeg({
            op: 'extract-audio',
            args,
            progressChannel: 'audio-progress',
            totalUs: (totalDuration || 1) * 1_000_000
        });
        return ffmpegFailure(r) || { success: true, fileSize: fileSizeOrZero(outputPath) };
    });

    // Export video at different speed
    ipcMain.handle('speed-video', async (_event, params) => {
        const { inputPath, outputPath, speed, totalDuration } = params;

        const videoFilter = `setpts=${(1 / speed).toFixed(4)}*PTS`;
        const audioFilter = `atempo=${speed}`;

        const args = [
            '-y', '-i', inputPath,
            '-filter:v', videoFilter,
            '-filter:a', audioFilter,
            '-c:v', 'libx264', '-crf', '18', '-preset', 'fast', '-pix_fmt', 'yuv420p',
            '-progress', 'pipe:1',
            outputPath
        ];

        // Output runs at the new speed, so progress is measured against the
        // sped-up duration, not the input duration.
        const r = await runFfmpeg({
            op: 'speed-video',
            args,
            progressChannel: 'speed-progress',
            totalUs: ((totalDuration || 1) / speed) * 1_000_000
        });
        return ffmpegFailure(r) || { success: true, fileSize: fileSizeOrZero(outputPath) };
    });

    // Video concat (join multiple videos)
    ipcMain.handle('concat-videos', async (_event, params) => {
        const { inputPaths, outputPath, totalDuration } = params;

        // Create concat file list
        const listPath = path.join(app.getPath('temp'), `revid-concat-${Date.now()}.txt`);
        const listContent = inputPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
        fs.writeFileSync(listPath, listContent);

        const args = [
            '-y', '-f', 'concat', '-safe', '0',
            '-i', listPath,
            '-c', 'copy',
            '-progress', 'pipe:1',
            outputPath
        ];

        try {
            const r = await runFfmpeg({
                op: 'concat-videos',
                args,
                progressChannel: 'concat-progress',
                totalUs: (totalDuration || 1) * 1_000_000
            });
            return ffmpegFailure(r) || { success: true, fileSize: fileSizeOrZero(outputPath) };
        } finally {
            try { fs.unlinkSync(listPath); } catch (e) {}
        }
    });

    // Crop + trim video using ffmpeg (runs in main process).
    // crop is optional (null = keep full frame). fastCopy stream-copies the
    // trim range without re-encoding — near-instant, but cuts land on the
    // keyframe at/before the requested start.
    ipcMain.handle('crop-video', async (_event, params) => {
        const { inputPath, outputPath, crop, trim, totalDuration, fastCopy, replaceOriginal, opId } = params;

        // The editor's background export gets its own op + progress channel,
        // so it can't cancel (or be cancelled by) BatchCropDialog jobs that
        // share this handler, and their progress events never interleave.
        const op = opId === 'editor-export' ? 'editor-export' : 'crop-video';
        const progressChannel = op === 'editor-export' ? 'editor-export-progress' : 'crop-progress';

        // ffmpeg runs with -y: writing onto the file it is reading destroys it.
        const samePath = process.platform === 'win32'
            ? path.resolve(inputPath).toLowerCase() === path.resolve(outputPath).toLowerCase()
            : path.resolve(inputPath) === path.resolve(outputPath);
        if (samePath) {
            return { success: false, error: 'Output file must differ from the source video' };
        }
        const nums = [
            ...(crop ? [crop.x, crop.y, crop.width, crop.height] : []),
            ...(trim ? [trim.startTime, trim.endTime] : [])
        ];
        if (!nums.every(Number.isFinite)) {
            return { success: false, error: 'Invalid crop/trim values' };
        }

        // When trimming, the output only spans the trimmed range — measure
        // progress against that, not the full input duration.
        const outputDuration = trim
            ? Math.max(trim.endTime - trim.startTime, 0.001)
            : (totalDuration || 1);

        const useCopy = Boolean(fastCopy) && !crop;

        const buildArgs = (encoder, copy, transcodeAudio) => {
            const args = ['-y'];
            if (trim) {
                args.push('-ss', String(trim.startTime));
            }
            args.push('-i', inputPath);
            if (copy) {
                if (trim) args.push('-t', String(outputDuration));
                args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
            } else {
                if (trim) args.push('-t', String(outputDuration));
                // yuv420p/nv12 encoders reject odd dimensions; when there is
                // no user crop, still trim stray odd rows/columns off sources
                // like window captures (e.g. 1365x767).
                args.push('-vf', crop
                    ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`
                    : 'crop=trunc(iw/2)*2:trunc(ih/2)*2');
                args.push('-c:v', encoder, ...H264_ENCODE_ARGS[encoder]);
                // The fallback also re-encodes audio: an mp4-incompatible
                // audio codec (Opus in MKV) fails identically under -c:a copy.
                if (transcodeAudio) args.push('-c:a', 'aac', '-b:a', '192k');
                else args.push('-c:a', 'copy');
            }
            args.push('-movflags', '+faststart');
            args.push('-progress', 'pipe:1');
            args.push(outputPath);
            return args;
        };

        const run = (encoder, copy, transcodeAudio) => runFfmpeg({
            op,
            args: buildArgs(encoder, copy, transcodeAudio),
            progressChannel,
            totalUs: outputDuration * 1_000_000
        });

        // The encoder probe and the retry below both leave windows where no
        // ffmpeg process exists for cancel-ffmpeg to kill — compare the cancel
        // epoch around each await so a cancel landing there still sticks.
        const epoch = getCancelEpoch(op);
        const cancelledResult = { success: false, cancelled: true, error: 'Cancelled' };

        const encoder = useCopy ? 'libx264' : await getH264Encoder();
        if (getCancelEpoch(op) !== epoch) return cancelledResult;

        let r = await run(encoder, useCopy, false);

        // Fall back once to a software re-encode: a hardware encoder that
        // probed OK can still fail on a real input, and a stream copy can hit
        // codecs the mp4 container refuses (e.g. Opus audio from an MKV).
        if (r.code !== 0 && !r.cancelled && (useCopy || encoder !== 'libx264')) {
            if (getCancelEpoch(op) !== epoch) return cancelledResult;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(progressChannel, 0);
            }
            r = await run('libx264', false, true);
        }

        const failure = ffmpegFailure(r);
        if (failure) {
            // Never leave a corrupt partial output at the destination.
            try { await fs.promises.unlink(outputPath); } catch (e) { /* none written */ }
            return failure;
        }
        if (replaceOriginal) {
            return await replaceOriginalFile(outputPath, inputPath);
        }
        return { success: true };
    });

    // Scan a batch of videos for the position of a known audio segment
    // (the batch-cut "template"). Sequential; per-file progress events on
    // 'segment-scan-progress'. Cancellable via cancel-ffmpeg('segment-scan').
    ipcMain.handle('find-segment-matches', async (_event, params) => {
        const { templatePath, templateStart, templateEnd, targets } = params;
        if (!Array.isArray(targets) || targets.length === 0) {
            return { success: false, error: 'No target files' };
        }
        if (![templateStart, templateEnd].every(Number.isFinite) || templateEnd - templateStart < 0.5) {
            return { success: false, error: 'Invalid template range' };
        }

        const epoch = getCancelEpoch('segment-scan');
        const sendProgress = (payload) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('segment-scan-progress', payload);
            }
        };

        const templateEnv = await extractEnvelope(templatePath, {
            op: 'segment-scan',
            start: templateStart,
            duration: templateEnd - templateStart
        });
        // A cancel can kill the template decode itself — report it as a
        // cancel, not as "no audio", and never scan with a truncated template.
        if (getCancelEpoch('segment-scan') !== epoch) {
            return { success: false, cancelled: true, error: 'Cancelled' };
        }
        if (!templateEnv) {
            return { success: false, error: 'Template segment has no usable audio' };
        }

        const results = [];
        for (let i = 0; i < targets.length; i++) {
            if (getCancelEpoch('segment-scan') !== epoch) {
                return { success: false, cancelled: true, error: 'Cancelled' };
            }
            const target = targets[i];
            sendProgress({ index: i, path: target, phase: 'scanning' });

            const env = await extractEnvelope(target, { op: 'segment-scan' });
            if (getCancelEpoch('segment-scan') !== epoch) {
                return { success: false, cancelled: true, error: 'Cancelled' };
            }

            let result;
            if (!env) {
                result = { path: target, found: false, score: 0, matchStart: 0, targetDuration: 0, noAudio: true };
            } else {
                const m = findSegmentOffset(env, templateEnv);
                result = {
                    path: target,
                    found: m.found,
                    score: m.score,
                    matchStart: m.offsetSeconds,
                    // Audio length ≈ video length; lets the dialog reject cut
                    // points that fall at/after the end of the file.
                    targetDuration: env.length / FRAMES_PER_SECOND
                };
            }
            results.push(result);
            sendProgress({ index: i, path: target, phase: 'done', result });
        }
        return { success: true, results };
    });

    // Cut each video so only [0, cutAt) survives. Sequential; progress via
    // 'batch-cut-progress' ({index, path} on file start, {index, pct} during).
    // fastCopy keeps streams as-is (start at 0 is naturally keyframe-aligned);
    // otherwise re-encode on the detected H.264 encoder.
    ipcMain.handle('batch-cut-videos', async (_event, params) => {
        const { jobs, replaceOriginal: replaceAll, fastCopy } = params;
        if (!Array.isArray(jobs) || jobs.length === 0) {
            return { success: false, error: 'No cut jobs' };
        }

        const epoch = getCancelEpoch('batch-cut');
        const sendProgress = (payload) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('batch-cut-progress', payload);
            }
        };

        const encoder = fastCopy ? 'libx264' : await getH264Encoder();
        const results = [];

        // Output names must never collide with another job's INPUT (a prior
        // run's "-cut.mp4" may itself be in the batch) nor silently overwrite
        // an existing file — this is a bulk operation with no save dialog.
        const normalizePath = (p) => (process.platform === 'win32'
            ? path.resolve(p).toLowerCase()
            : path.resolve(p));
        const reserved = new Set(jobs.map(j => normalizePath(j.inputPath)));
        const pickOutputPath = (dir, base) => {
            let candidate = path.join(dir, `${base}-cut.mp4`);
            for (let n = 2; reserved.has(normalizePath(candidate)) || fs.existsSync(candidate); n++) {
                candidate = path.join(dir, `${base}-cut-${n}.mp4`);
            }
            reserved.add(normalizePath(candidate));
            return candidate;
        };

        for (let i = 0; i < jobs.length; i++) {
            if (getCancelEpoch('batch-cut') !== epoch) {
                return { success: false, cancelled: true, results, error: 'Cancelled' };
            }
            const { inputPath, cutAt } = jobs[i];
            if (!Number.isFinite(cutAt) || cutAt <= 0.1) {
                const result = { path: inputPath, success: false, error: 'Invalid cut point' };
                results.push(result);
                sendProgress({ index: i, path: inputPath, phase: 'done', result });
                continue;
            }
            sendProgress({ index: i, path: inputPath, phase: 'start' });

            const ext = path.extname(inputPath);
            const base = path.basename(inputPath, ext);
            const dir = path.dirname(inputPath);
            const outputPath = replaceAll
                ? path.join(dir, `${base}.revid-tmp.mp4`)
                : pickOutputPath(dir, base);

            const buildArgs = (enc, copy, transcodeAudio) => {
                const args = ['-y', '-i', inputPath, '-t', String(cutAt)];
                if (copy) {
                    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
                } else {
                    args.push('-vf', 'crop=trunc(iw/2)*2:trunc(ih/2)*2');
                    args.push('-c:v', enc, ...H264_ENCODE_ARGS[enc]);
                    if (transcodeAudio) args.push('-c:a', 'aac', '-b:a', '192k');
                    else args.push('-c:a', 'copy');
                }
                args.push('-movflags', '+faststart', '-progress', 'pipe:1', outputPath);
                return args;
            };

            let r = await runFfmpeg({
                op: 'batch-cut',
                args: buildArgs(encoder, Boolean(fastCopy), false),
                progressChannel: 'batch-cut-progress-pct',
                totalUs: cutAt * 1_000_000
            });
            // Same fallback as single export: software re-encode (with audio
            // transcode — mp4-incompatible audio fails -c:a copy identically).
            // Retrying an identical libx264 command would just double the cost.
            if (r.code !== 0 && !r.cancelled && (fastCopy || encoder !== 'libx264')) {
                if (getCancelEpoch('batch-cut') !== epoch) {
                    return { success: false, cancelled: true, results, error: 'Cancelled' };
                }
                r = await runFfmpeg({
                    op: 'batch-cut',
                    args: buildArgs('libx264', false, true),
                    progressChannel: 'batch-cut-progress-pct',
                    totalUs: cutAt * 1_000_000
                });
            }

            const failure = ffmpegFailure(r);
            if (failure) {
                try { await fs.promises.unlink(outputPath); } catch (e) { /* none written */ }
                results.push({ path: inputPath, success: false, error: failure.error, cancelled: failure.cancelled });
                if (failure.cancelled) {
                    return { success: false, cancelled: true, results, error: 'Cancelled' };
                }
            } else if (replaceAll) {
                const swapped = await replaceOriginalFile(outputPath, inputPath);
                results.push({ path: inputPath, success: swapped.success, error: swapped.error, newPath: swapped.newPath });
            } else {
                results.push({ path: inputPath, success: true, outputPath });
            }
            sendProgress({ index: i, path: inputPath, phase: 'done', result: results[results.length - 1] });
        }
        return { success: true, results };
    });

    // --- Whisper auto-subtitles ---

    ipcMain.handle('whisper-status', () => {
        try {
            return { success: true, ...getWhisperStatus(DEFAULT_MODEL) };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // One-time download of the whisper binary + model, with progress events.
    let whisperSetupRunning = false;
    ipcMain.handle('whisper-setup', async (_event, params = {}) => {
        if (whisperSetupRunning) return { success: false, error: 'Setup already running' };
        whisperSetupRunning = true;
        try {
            const status = await ensureWhisper(
                { flavor: params.flavor || 'cuda', model: DEFAULT_MODEL },
                (p) => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('whisper-setup-progress', p);
                    }
                }
            );
            return { success: true, ...status };
        } catch (e) {
            return { success: false, error: e.message };
        } finally {
            whisperSetupRunning = false;
        }
    });

    // Transcription is serialised through one queue: whisper saturates the
    // machine, and the video being watched must not wait behind a folder sweep.
    const subtitlesExist = (videoPath) => {
        const base = videoPath.replace(/\.[^.]+$/, '');
        return fs.existsSync(`${base}.srt`)
            || fs.existsSync(`${base}.vtt`)
            || fs.existsSync(cachedSubtitlePath(videoPath, '.srt'));
    };

    const sendWhisper = (videoPath, payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('whisper-event', { videoPath, ...payload });
        }
    };

    const whisperQueue = createWhisperQueue({
        hasSubtitles: subtitlesExist,
        onEvent: (e) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('whisper-queue', e);
            }
        },
        runJob: async (videoPath) => {
            const status = getWhisperStatus(DEFAULT_MODEL);
            if (!status.binaryReady || !status.modelReady) {
                return { success: false, notReady: true, error: 'Whisper not set up' };
            }
            const epoch = getCancelEpoch('whisper');
            sendWhisper(videoPath, { type: 'start' });
            const result = await transcribeVideo(
                {
                    videoPath,
                    exePath: status.exePath,
                    fallbackExePath: status.fallbackExePath,
                    modelPath: status.modelPath,
                    op: 'whisper'
                },
                {
                    onCue: (cue) => sendWhisper(videoPath, { type: 'cue', cue }),
                    onProgress: (pct) => sendWhisper(videoPath, { type: 'progress', pct })
                }
            );
            // Cancelled: only discard the .srt if the run did NOT finish. A
            // completed transcription is valid work and must survive a cancel
            // that merely raced the finish — deleting it silently redoes
            // minutes of work on the next open.
            if (getCancelEpoch('whisper') !== epoch && !result.success) {
                const base = videoPath.replace(/\.[^.]+$/, '');
                try { await fs.promises.unlink(`${base}.srt`); } catch (e) { /* none */ }
                return { success: false, cancelled: true, error: 'Cancelled' };
            }
            sendWhisper(videoPath, {
                type: 'done', success: result.success, srtPath: result.srtPath, error: result.error
            });
            return result;
        }
    });

    ipcMain.handle('transcribe-video', async (_event, { videoPath }) => {
        if (!videoPath || !fs.existsSync(videoPath)) {
            return { success: false, error: 'File not found' };
        }
        if (subtitlesExist(videoPath)) {
            return { success: true, skipped: true, srtPath: `${videoPath.replace(/\.[^.]+$/, '')}.srt` };
        }
        const status = getWhisperStatus(DEFAULT_MODEL);
        if (!status.binaryReady || !status.modelReady) {
            return { success: false, notReady: true, error: 'Whisper not set up' };
        }
        // The video on screen outranks anything queued by the folder sweep.
        const pending = whisperQueue.enqueue(videoPath, 0);
        return pending ? await pending : { success: true, skipped: true };
    });

    // Background-transcribe every video in the open folder that has no
    // subtitles yet, so the library fills in while the user watches.
    ipcMain.handle('queue-folder-transcriptions', async (_event, { videoPaths }) => {
        if (!Array.isArray(videoPaths)) return { success: false, error: 'No files' };
        const status = getWhisperStatus(DEFAULT_MODEL);
        if (!status.binaryReady || !status.modelReady) {
            return { success: false, notReady: true, error: 'Whisper not set up' };
        }
        const added = whisperQueue.enqueueFolder(videoPaths.filter(p => fs.existsSync(p)));
        return { success: true, added, ...whisperQueue.status() };
    });

    ipcMain.handle('clear-transcription-queue', () => {
        whisperQueue.clearPending();
        return { success: true };
    });

    // Throw away a video's subtitles and transcribe it again — for when the
    // existing ones are wrong (bad timing, wrong language, a bad model).
    ipcMain.handle('retranscribe-video', async (_event, { videoPath, alsoTranslation = true }) => {
        if (!videoPath || !fs.existsSync(videoPath)) {
            return { success: false, error: 'File not found' };
        }
        const base = videoPath.replace(/\.[^.]+$/, '');
        const targets = [`${base}.srt`, cachedSubtitlePath(videoPath, '.srt')];
        if (alsoTranslation) {
            targets.push(`${base}.zh.srt`, cachedSubtitlePath(videoPath, '.zh.srt'));
        }
        for (const p of targets) {
            try { await fs.promises.unlink(p); } catch (e) { /* absent */ }
        }
        const pending = whisperQueue.enqueue(videoPath, 0);
        return pending ? await pending : { success: true, skipped: true };
    });

    // Translate a cue list and persist it as a <video>.zh.srt sidecar, so the
    // work is done once per video. Cancellable by starting another request.
    let translateToken = 0;
    ipcMain.handle('translate-subtitles', async (_event, params) => {
        const { videoPath, cues, engine, apiKey, model } = params;
        if (!Array.isArray(cues) || cues.length === 0) {
            return { success: false, error: 'No subtitles to translate' };
        }
        if (engine === 'gemini' && !apiKey) {
            return { success: false, needsKey: true, error: 'Gemini API key not set' };
        }

        const token = ++translateToken;
        const result = await translateLines(
            cues.map(c => c.text),
            { engine, apiKey, model },
            (pct) => {
                if (token !== translateToken) return;
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('translate-progress', { videoPath, pct });
                }
            }
        );
        if (token !== translateToken) return { success: false, cancelled: true, error: 'Superseded' };
        if (!result.success) return result;

        // Persist beside the video in the same SRT shape as the source.
        const toStamp = (s) => {
            const h = String(Math.floor(s / 3600)).padStart(2, '0');
            const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
            const sec = String(Math.floor(s % 60)).padStart(2, '0');
            const ms = String(Math.round((s - Math.floor(s)) * 1000)).padStart(3, '0');
            return `${h}:${m}:${sec},${ms}`;
        };
        const srt = cues.map((c, i) =>
            `${i + 1}\n${toStamp(c.start)} --> ${toStamp(c.end)}\n${result.translations[i]}\n`
        ).join('\n');

        const zhPath = `${videoPath.replace(/\.[^.]+$/, '')}.zh.srt`;
        try {
            await fs.promises.writeFile(zhPath, srt, 'utf8');
            return { success: true, translations: result.translations, zhPath };
        } catch (e) {
            // Folder not writable — keep the translation in the cache so it
            // isn't redone on the next open.
            try {
                const cached = cachedSubtitlePath(videoPath, '.zh.srt');
                await fs.promises.writeFile(cached, srt, 'utf8');
                return { success: true, translations: result.translations, zhPath: cached, cached: true };
            } catch (e2) {
                return { success: true, translations: result.translations, saveError: e.message };
            }
        }
    });

    // --- Watch on another device ---

    ipcMain.handle('lan-start', async (_event, { folder }) => await lanServer.start({ folder }));
    ipcMain.handle('lan-stop', () => lanServer.stop());
    ipcMain.handle('lan-status', () => lanServer.status());

    // --- Offline dictionary (ECDICT) ---

    ipcMain.handle('dict-lookup', (_event, { word }) => {
        try {
            return { success: true, entry: dictionary.lookup(word) };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Difficult words for a batch of lines, keyed by line index so the
    // renderer can highlight without a round-trip per word.
    ipcMain.handle('dict-mark-difficult', (_event, { lines, options }) => {
        try {
            const result = {};
            (lines || []).forEach((text, i) => {
                const hits = dictionary.markDifficult(text || '', options || {});
                if (hits.length) {
                    result[i] = hits.map(h => ({ word: h.word, base: h.base, start: h.start, end: h.end }));
                }
            });
            return { success: true, marks: result };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('dict-word-bank', (_event, { cues, options }) => {
        try {
            return { success: true, words: dictionary.buildWordBank(cues || [], options || {}) };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Write a PDF the renderer produced. react-pdf runs there (it is ESM and
    // its browser build fetches fonts over http), so main only persists the
    // bytes and shows the save dialog.
    ipcMain.handle('save-pdf', async (_event, { data, defaultName }) => {
        if (!mainWindow) return { success: false, error: 'No window' };
        const picked = await dialog.showSaveDialog(mainWindow, {
            defaultPath: defaultName || 'revid-export.pdf',
            filters: [{ name: 'PDF', extensions: ['pdf'] }]
        });
        if (picked.canceled || !picked.filePath) return { success: false, canceled: true };
        try {
            await fs.promises.writeFile(picked.filePath, Buffer.from(data));
            return { success: true, path: picked.filePath };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Cut the chosen ranges out of a video and join them into one clip —
    // "edit by picking lines in the transcript". Each range is extracted to a
    // temp file first because concat needs uniform streams, and a single
    // filter_complex over many inputs blows up on long videos.
    ipcMain.handle('cut-ranges', async (_event, params) => {
        const { inputPath, ranges, outputPath } = params;
        if (!inputPath || !Array.isArray(ranges) || ranges.length === 0) {
            return { success: false, error: 'Nothing to cut' };
        }
        if (!ranges.every(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)) {
            return { success: false, error: 'Invalid range' };
        }

        const epoch = getCancelEpoch('cut-ranges');
        const encoder = await getH264Encoder();
        if (getCancelEpoch('cut-ranges') !== epoch) {
            return { success: false, cancelled: true, error: 'Cancelled' };
        }

        const work = path.join(app.getPath('temp'), `revid-cut-${Date.now()}`);
        await fs.promises.mkdir(work, { recursive: true });
        const parts = [];
        const total = ranges.reduce((n, r) => n + (r.end - r.start), 0);
        let elapsed = 0;

        const sendProgress = (pct) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('cut-ranges-progress', Math.min(99, pct));
            }
        };

        try {
            for (const [i, r] of ranges.entries()) {
                if (getCancelEpoch('cut-ranges') !== epoch) {
                    return { success: false, cancelled: true, error: 'Cancelled' };
                }
                const part = path.join(work, `part-${String(i).padStart(3, '0')}.mp4`);
                const dur = r.end - r.start;
                // Re-encoded, not stream-copied: parts must start on a real
                // frame or the join stutters at every seam.
                const r1 = await runFfmpeg({
                    op: 'cut-ranges',
                    args: [
                        '-y', '-ss', String(r.start), '-i', inputPath, '-t', String(dur),
                        '-vf', 'crop=trunc(iw/2)*2:trunc(ih/2)*2',
                        '-c:v', encoder, ...H264_ENCODE_ARGS[encoder],
                        '-c:a', 'aac', '-b:a', '192k',
                        '-avoid_negative_ts', 'make_zero',
                        '-progress', 'pipe:1', part
                    ],
                    totalUs: dur * 1_000_000
                });
                const failure = ffmpegFailure(r1);
                if (failure) return failure;
                parts.push(part);
                elapsed += dur;
                sendProgress(Math.round((elapsed / total) * 90));
            }

            if (parts.length === 1) {
                await fs.promises.copyFile(parts[0], outputPath);
            } else {
                const listFile = path.join(work, 'list.txt');
                await fs.promises.writeFile(
                    listFile,
                    parts.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
                    'utf8'
                );
                const r2 = await runFfmpeg({
                    op: 'cut-ranges',
                    args: [
                        '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
                        '-c', 'copy', '-movflags', '+faststart',
                        '-progress', 'pipe:1', outputPath
                    ],
                    totalUs: total * 1_000_000
                });
                const failure = ffmpegFailure(r2);
                if (failure) return failure;
            }
            sendProgress(100);
            return { success: true, outputPath, clips: parts.length };
        } finally {
            try { await fs.promises.rm(work, { recursive: true, force: true }); } catch (e) { /* leave it */ }
        }
    });

    // Overwrite a video's subtitles after the user corrects them. Whisper
    // mishears names and jargon, and a wrong transcript poisons the
    // translation, the word list and every export built from it.
    ipcMain.handle('save-subtitles', async (_event, { videoPath, cues, translated }) => {
        if (!videoPath || !Array.isArray(cues) || cues.length === 0) {
            return { success: false, error: 'Nothing to save' };
        }
        const toStamp = (s) => {
            const h = String(Math.floor(s / 3600)).padStart(2, '0');
            const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
            const sec = String(Math.floor(s % 60)).padStart(2, '0');
            const ms = String(Math.round((s - Math.floor(s)) * 1000)).padStart(3, '0');
            return `${h}:${m}:${sec},${ms}`;
        };
        const body = cues.map((c, i) =>
            `${i + 1}\n${toStamp(c.start)} --> ${toStamp(c.end)}\n${c.text}\n`
        ).join('\n');

        const suffix = translated ? '.zh.srt' : '.srt';
        const target = `${videoPath.replace(/\.[^.]+$/, '')}${suffix}`;
        try {
            await fs.promises.writeFile(target, body, 'utf8');
            return { success: true, path: target };
        } catch (e) {
            try {
                const cached = cachedSubtitlePath(videoPath, suffix);
                await fs.promises.writeFile(cached, body, 'utf8');
                return { success: true, path: cached, cached: true };
            } catch (e2) {
                return { success: false, error: e.message };
            }
        }
    });

    // Generic byte writer for exports that aren't PDFs (word list CSV).
    ipcMain.handle('save-text-file', async (_event, { data, defaultName }) => {
        if (!mainWindow) return { success: false, error: 'No window' };
        const ext = path.extname(defaultName || '').replace('.', '') || 'txt';
        const picked = await dialog.showSaveDialog(mainWindow, {
            defaultPath: defaultName || 'export.txt',
            filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
        });
        if (picked.canceled || !picked.filePath) return { success: false, canceled: true };
        try {
            await fs.promises.writeFile(picked.filePath, Buffer.from(data));
            return { success: true, path: picked.filePath };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('open-path', (_event, { target }) => {
        shell.showItemInFolder(target);
        return { success: true };
    });

    // --- Plugins ---

    ipcMain.handle('plugins-list', () => {
        try {
            return { success: true, plugins: pluginHost.listPlugins(), dir: pluginHost.pluginsDir() };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('plugin-set-enabled', (_event, { id, enabled }) => ({
        success: pluginHost.setPluginEnabled(id, Boolean(enabled))
    }));

    ipcMain.handle('plugin-install', async () => {
        if (!mainWindow) return { success: false, error: 'No window' };
        const picked = await dialog.showOpenDialog(mainWindow, {
            title: 'Select a plugin folder',
            properties: ['openDirectory']
        });
        if (picked.canceled || !picked.filePaths[0]) return { success: false, canceled: true };
        return pluginHost.installPluginFromFolder(picked.filePaths[0]);
    });

    ipcMain.handle('plugin-uninstall', (_event, { id }) => pluginHost.uninstallPlugin(id));

    ipcMain.handle('plugins-open-folder', () => {
        shell.openPath(pluginHost.pluginsDir());
        return { success: true };
    });

    // --- Mini Player IPC Handlers ---

    ipcMain.handle('mini-player-open', (event, options = {}) => {
        if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
            miniPlayerWindow.focus();
            miniPlayerWindow.webContents.send('mini-player-init', options);
            return { success: true, alreadyOpen: true };
        }

        const baseUrl = rendererBaseUrl;

        miniPlayerWindow = new BrowserWindow({
            width: 400,
            height: 250,
            minWidth: 200,
            minHeight: 130,
            frame: false,
            alwaysOnTop: true,
            resizable: true,
            transparent: false,
            skipTaskbar: false,
            title: 'Mini Player',
            webPreferences: {
                preload: path.join(__dirname, 'preload.cjs'),
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: false,
                webSecurity: false
            }
        });

        miniPlayerWindow.loadURL(`${baseUrl}/?mode=mini-player`);

        miniPlayerWindow.webContents.once('did-finish-load', () => {
            if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
                miniPlayerWindow.webContents.send('mini-player-init', options);
            }
        });

        miniPlayerWindow.on('closed', () => {
            miniPlayerWindow = null;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('mini-player-closed');
            }
        });

        return { success: true };
    });

    ipcMain.handle('mini-player-close', () => {
        if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
            miniPlayerWindow.close();
            miniPlayerWindow = null;
        }
        return { success: true };
    });

    ipcMain.handle('mini-player-set-opacity', (event, opacity) => {
        if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
            const clamped = Math.max(0.2, Math.min(1.0, opacity));
            miniPlayerWindow.setOpacity(clamped);
            return { success: true, opacity: clamped };
        }
        return { success: false, error: 'Mini player not open' };
    });

    ipcMain.on('mini-player-time-sync', (event, data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('mini-player-update', data);
        }
    });

    ipcMain.on('mini-player-send', (event, data) => {
        if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
            miniPlayerWindow.webContents.send('mini-player-update', data);
        }
    });

    // --- Custom title-bar window controls (frameless window) ---
    ipcMain.on('window-minimize', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize(); });
    ipcMain.on('window-maximize', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
    });
    ipcMain.on('window-close', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close(); });

    // --- Music mini-panel: shrink the whole window to a floating player ---
    ipcMain.handle('set-music-mini', (_event, enter) => {
        if (!mainWindow || mainWindow.isDestroyed()) return { success: false };
        const MINI_W = 400, MINI_H = 92;
        if (enter) {
            if (!savedMusicBounds) {
                savedMusicMaximized = mainWindow.isMaximized();
                savedMusicBounds = mainWindow.getNormalBounds();
            }
            // Flag first so the resize events below aren't persisted.
            isMusicMini = true;
            clearTimeout(saveWindowStateTimer);
            if (mainWindow.isMaximized()) mainWindow.unmaximize();
            mainWindow.setMinimumSize(300, 80);
            mainWindow.setAlwaysOnTop(true);
            mainWindow.setSize(MINI_W, MINI_H);
            // Fixed-size panel: removes the window's edge resize zones so the
            // bottom progress bar is clickable (clicks there were resizing).
            mainWindow.setResizable(false);
            try {
                const { screen } = require('electron');
                const wa = screen.getPrimaryDisplay().workArea;
                mainWindow.setPosition(wa.x + wa.width - MINI_W - 20, wa.y + wa.height - MINI_H - 20);
            } catch {}
        } else {
            // Already in the normal layout — nothing to restore. (Lets the
            // renderer safely re-assert "not mini" without clobbering the size.)
            if (!isMusicMini) return { success: true };
            isMusicMini = false;
            mainWindow.setResizable(true);
            mainWindow.setAlwaysOnTop(userAlwaysOnTop);
            mainWindow.setMinimumSize(640, 480);
            if (savedMusicBounds) {
                mainWindow.setBounds(savedMusicBounds);
                if (savedMusicMaximized) mainWindow.maximize();
                savedMusicBounds = null;
                savedMusicMaximized = false;
                scheduleSaveWindowState();
            } else {
                // Never leave the window stuck at the tiny mini size.
                const cur = mainWindow.getBounds();
                if (cur.width < 640 || cur.height < 480) {
                    mainWindow.setSize(1100, 720);
                    mainWindow.center();
                }
            }
        }
        return { success: true };
    });

    // --- Always on Top ---

    ipcMain.handle('set-always-on-top', (_event, value) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            userAlwaysOnTop = !!value;
            mainWindow.setAlwaysOnTop(userAlwaysOnTop);
            saveWindowState();
            return { success: true, alwaysOnTop: userAlwaysOnTop };
        }
        return { success: false };
    });

    ipcMain.handle('get-always-on-top', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            return { success: true, alwaysOnTop: userAlwaysOnTop };
        }
        return { success: false, alwaysOnTop: false };
    });

    // --- Theater Session Persistence ---

    ipcMain.handle('create-persistent-session', (event, platform) => {
        if (!platform || typeof platform !== 'string') {
            return { success: false, error: 'Invalid platform' };
        }
        const partitionName = `persist:theater-${platform}`;
        const { session } = require('electron');
        session.fromPartition(partitionName);
        return { success: true, partition: partitionName };
    });

    // --- Thumbnail Fetch + Cache ---

    const thumbnailDir = path.join(app.getPath('userData'), 'thumbnails');

    const ensureThumbnailDir = () => {
        if (!fs.existsSync(thumbnailDir)) {
            fs.mkdirSync(thumbnailDir, { recursive: true });
        }
    };

    // Clean thumbnails older than 30 days
    const cleanOldThumbnails = () => {
        try {
            if (!fs.existsSync(thumbnailDir)) return;
            const now = Date.now();
            const maxAge = 30 * 24 * 60 * 60 * 1000;
            const files = fs.readdirSync(thumbnailDir);
            for (const file of files) {
                const filePath = path.join(thumbnailDir, file);
                try {
                    const stat = fs.statSync(filePath);
                    if (now - stat.atimeMs > maxAge) {
                        fs.unlinkSync(filePath);
                    }
                } catch {}
            }
        } catch {}
    };

    // Thumbnail cleanup scans the cache dir synchronously — push it off the
    // startup critical path so the window/video appear sooner.
    setTimeout(cleanOldThumbnails, 8000);

    ipcMain.handle('fetch-thumbnail', async (_event, { url, courseId }) => {
        if (!url || !courseId) return { success: false, error: 'Missing url or courseId' };
        if (!/^https?:\/\//i.test(url)) return { success: false, error: 'Only http(s) URLs allowed' };

        ensureThumbnailDir();

        // Check cache first
        const cachedPath = path.join(thumbnailDir, `${courseId}.jpg`);
        if (fs.existsSync(cachedPath)) {
            // Touch atime
            try {
                const now = new Date();
                fs.utimesSync(cachedPath, now, fs.statSync(cachedPath).mtime);
            } catch {}
            return { success: true, thumbnailPath: cachedPath };
        }

        try {
            // Fetch the page HTML and extract og:image
            const https = require('https');
            const http = require('http');

            const fetchUrl = (targetUrl) => new Promise((resolve, reject) => {
                const protocol = targetUrl.startsWith('https') ? https : http;
                const req = protocol.get(targetUrl, {
                    timeout: 10000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                }, (res) => {
                    // Follow redirects
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        fetchUrl(res.headers.location).then(resolve).catch(reject);
                        return;
                    }
                    const chunks = [];
                    res.on('data', (chunk) => chunks.push(chunk));
                    res.on('end', () => resolve({
                        body: Buffer.concat(chunks),
                        contentType: res.headers['content-type'] || ''
                    }));
                });
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            });

            const { body, contentType } = await fetchUrl(url);

            let imageUrl = null;

            if (contentType.includes('text/html')) {
                const html = body.toString('utf-8').slice(0, 50000);
                const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
                    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
                if (ogMatch) {
                    imageUrl = ogMatch[1];
                }
            }

            if (!imageUrl) {
                return { success: false, error: 'No og:image found' };
            }

            // Download the image
            const { body: imgData } = await fetchUrl(imageUrl);
            fs.writeFileSync(cachedPath, imgData);

            return { success: true, thumbnailPath: cachedPath };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Download video file (supports direct URLs and m3u8/HLS streams)
    ipcMain.handle('download-video', async (_event, { url, filename }) => {
        if (!url || !mainWindow) return { success: false, error: 'Missing url or window' };
        if (!/^https?:\/\//i.test(url)) return { success: false, error: 'Only http(s) URLs allowed' };

        const isHLS = url.includes('.m3u8');

        // Show save dialog - force mp4 extension for HLS
        const defaultFilename = isHLS
            ? (filename?.replace(/\.[^.]+$/, '.mp4') || 'video.mp4')
            : (filename || 'video.mp4');

        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: defaultFilename,
            filters: [
                { name: 'Video', extensions: ['mp4', 'webm', 'mkv', 'avi'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (result.canceled || !result.filePath) {
            return { success: false, canceled: true };
        }

        const savePath = result.filePath;

        // Use ffmpeg for HLS/m3u8 streams
        if (isHLS) {
            return new Promise((resolve) => {
                const args = [
                    '-y',
                    '-i', url,
                    '-c', 'copy',
                    '-bsf:a', 'aac_adtstoasc',
                    '-progress', 'pipe:1',
                    savePath
                ];

                const proc = spawn(ffmpegPath, args);
                trackFfmpegProc('download-video', proc);
                let duration = 0;

                proc.stderr.on('data', (data) => {
                    const str = data.toString();
                    // Try to extract duration from stderr
                    const durMatch = str.match(/Duration:\s*(\d+):(\d+):(\d+)/);
                    if (durMatch) {
                        duration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseInt(durMatch[3]);
                    }
                });

                proc.stdout.on('data', (data) => {
                    const str = data.toString();
                    const timeMatch = str.match(/out_time_us=(\d+)/);
                    if (timeMatch && duration > 0 && mainWindow) {
                        const currentTime = parseInt(timeMatch[1]) / 1000000;
                        const progress = Math.min(99, Math.round((currentTime / duration) * 100));
                        mainWindow.webContents.send('download-progress', { progress });
                    }
                });

                proc.on('close', (code) => {
                    if (isCancelledFfmpegProc(proc)) {
                        fs.unlink(savePath, () => {});
                        resolve({ success: false, cancelled: true, error: 'Cancelled' });
                    } else if (code === 0) {
                        mainWindow?.webContents.send('download-progress', { progress: 100 });
                        resolve({ success: true, filePath: savePath });
                    } else {
                        fs.unlink(savePath, () => {});
                        resolve({ success: false, error: `ffmpeg exited with code ${code}` });
                    }
                });

                proc.on('error', (err) => {
                    fs.unlink(savePath, () => {});
                    resolve({ success: false, error: err.message });
                });
            });
        }

        // Direct download for non-HLS URLs
        return new Promise((resolve) => {
            const https = require('https');
            const http = require('http');
            const fileStream = fs.createWriteStream(savePath);

            const fetchWithRedirect = (targetUrl, redirectCount = 0) => {
                if (redirectCount > 5) {
                    resolve({ success: false, error: 'Too many redirects' });
                    return;
                }

                const protocol = targetUrl.startsWith('https') ? https : http;
                const req = protocol.get(targetUrl, {
                    timeout: 30000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                }, (res) => {
                    // Handle redirects
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        let redirectUrl = res.headers.location;
                        if (!redirectUrl.startsWith('http')) {
                            const urlObj = new URL(targetUrl);
                            redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
                        }
                        fetchWithRedirect(redirectUrl, redirectCount + 1);
                        return;
                    }

                    if (res.statusCode !== 200) {
                        resolve({ success: false, error: `HTTP ${res.statusCode}` });
                        return;
                    }

                    const totalSize = parseInt(res.headers['content-length'], 10) || 0;
                    let downloadedSize = 0;

                    res.on('data', (chunk) => {
                        downloadedSize += chunk.length;
                        if (totalSize > 0 && mainWindow) {
                            const progress = Math.round((downloadedSize / totalSize) * 100);
                            mainWindow.webContents.send('download-progress', { progress, downloaded: downloadedSize, total: totalSize });
                        }
                    });

                    res.pipe(fileStream);

                    fileStream.on('finish', () => {
                        fileStream.close();
                        resolve({ success: true, filePath: savePath });
                    });

                    fileStream.on('error', (err) => {
                        fs.unlink(savePath, () => {});
                        resolve({ success: false, error: err.message });
                    });
                });

                req.on('error', (err) => {
                    fs.unlink(savePath, () => {});
                    resolve({ success: false, error: err.message });
                });

                req.on('timeout', () => {
                    req.destroy();
                    fs.unlink(savePath, () => {});
                    resolve({ success: false, error: 'Download timeout' });
                });
            };

            fetchWithRedirect(url);
        });
    });

    ipcMain.handle('clear-session', async (event, platform) => {
        if (!platform || typeof platform !== 'string') {
            return { success: false, error: 'Invalid platform' };
        }
        try {
            const { session } = require('electron');
            const partitionName = `persist:theater-${platform}`;
            const ses = session.fromPartition(partitionName);
            await ses.clearStorageData();
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // --- .revid File Handlers ---

    ipcMain.handle('write-revid-file', async (_event, { filePath, data }) => {
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('write-revid-files-batch', async (_event, { dirPath, files }) => {
        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
            let written = 0;
            for (const file of files) {
                const fullPath = path.join(dirPath, file.fileName);
                fs.writeFileSync(fullPath, JSON.stringify(file.data, null, 2), 'utf-8');
                written++;
            }
            return { success: true, count: written };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('read-revid-file', async (_event, filePath) => {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content);
            return { success: true, data };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('select-revid-file', async () => {
        if (!mainWindow) return { success: false, error: 'No window' };
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'ReVid Files', extensions: ['revid'] },
                { name: 'JSON Backup', extensions: ['json'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });
        if (result.canceled || !result.filePaths.length) {
            return { success: false, canceled: true };
        }
        return { success: true, filePaths: result.filePaths };
    });

    ipcMain.handle('save-revid-file-dialog', async (_event, defaultName) => {
        if (!mainWindow) return { success: false, error: 'No window' };
        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: defaultName || 'video.revid',
            filters: [
                { name: 'ReVid File', extensions: ['revid'] }
            ]
        });
        if (result.canceled) {
            return { success: false, canceled: true };
        }
        return { success: true, filePath: result.filePath };
    });

    ipcMain.handle('export-theater-data', async (_event, { data, defaultName }) => {
        if (!mainWindow) return { success: false, error: 'No window' };
        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: defaultName || 'revid-backup.json',
            filters: [
                { name: 'JSON Backup', extensions: ['json'] }
            ]
        });
        if (result.canceled) {
            return { success: false, canceled: true };
        }
        try {
            fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
            return { success: true, filePath: result.filePath };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('import-theater-data', async () => {
        if (!mainWindow) return { success: false, error: 'No window' };
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [
                { name: 'JSON Backup', extensions: ['json'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });
        if (result.canceled || !result.filePaths.length) {
            return { success: false, canceled: true };
        }
        try {
            const content = fs.readFileSync(result.filePaths[0], 'utf-8');
            const data = JSON.parse(content);
            return { success: true, data };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // --- Upload Video File ---

    ipcMain.handle('upload-video-file', async (_event, { filePath, config }) => {
        try {
            const https = require('https');
            const http = require('http');
            const { URL } = require('url');

            const apiUrl = new URL(config.apiUrl);
            const isHttps = apiUrl.protocol === 'https:';
            const transport = isHttps ? https : http;

            const fileSize = fs.statSync(filePath).size;
            const fileName = path.basename(filePath);
            const boundary = `----ReVidBoundary${Date.now()}`;

            // Build multipart body parts
            const headerPart = Buffer.from(
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
                `Content-Type: video/mp4\r\n\r\n`
            );
            const footerPart = Buffer.from(`\r\n--${boundary}--\r\n`);
            const totalSize = headerPart.length + fileSize + footerPart.length;

            const headers = {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': totalSize,
            };

            // Auth headers
            if (config.authType === 'bearer' && config.authToken) {
                headers['Authorization'] = `Bearer ${config.authToken}`;
            } else if (config.authType === 'apikey' && config.authToken) {
                headers['X-API-Key'] = config.authToken;
            }

            // Custom headers
            if (config.customHeaders) {
                try {
                    const custom = typeof config.customHeaders === 'string'
                        ? JSON.parse(config.customHeaders)
                        : config.customHeaders;
                    Object.assign(headers, custom);
                } catch {}
            }

            return new Promise((resolve) => {
                const req = transport.request({
                    hostname: apiUrl.hostname,
                    port: apiUrl.port || (isHttps ? 443 : 80),
                    path: apiUrl.pathname + apiUrl.search,
                    method: 'POST',
                    headers,
                    timeout: 300000,
                }, (res) => {
                    const chunks = [];
                    res.on('data', (chunk) => chunks.push(chunk));
                    res.on('end', () => {
                        try {
                            const body = Buffer.concat(chunks).toString('utf-8');
                            const json = JSON.parse(body);
                            resolve({ success: true, data: json });
                        } catch (e) {
                            resolve({ success: false, error: `Invalid response: ${e.message}` });
                        }
                    });
                });

                req.on('error', (e) => {
                    resolve({ success: false, error: e.message });
                });

                req.on('timeout', () => {
                    req.destroy();
                    resolve({ success: false, error: 'Upload timeout' });
                });

                // Write multipart body with progress tracking
                req.write(headerPart);

                const readStream = fs.createReadStream(filePath);
                let uploaded = 0;

                readStream.on('data', (chunk) => {
                    req.write(chunk);
                    uploaded += chunk.length;
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        const pct = Math.round((uploaded / fileSize) * 100);
                        mainWindow.webContents.send('upload-progress', { filePath, pct });
                    }
                });

                readStream.on('end', () => {
                    req.write(footerPart);
                    req.end();
                });

                readStream.on('error', (e) => {
                    req.destroy();
                    resolve({ success: false, error: e.message });
                });
            });
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Upload a file to the user's pokkit account (login-gated). Streams from disk like
    // upload-video-file (no memory blowup for big videos), authenticates with the LetMeUse
    // Bearer token, then builds the public pokkit URL from the returned entry id.
    ipcMain.handle('upload-to-pokkit', async (_event, { filePath, token }) => {
        if (!token) return { success: false, error: 'not logged in' };
        try {
            const https = require('https');
            const POKKIT_BASE = 'https://pokkit.isnowfriend.com';
            const fileSize = fs.statSync(filePath).size;
            const fileName = path.basename(filePath);
            const boundary = `----ReVidPokkit${Date.now()}`;
            const headerPart = Buffer.from(
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
                `Content-Type: video/mp4\r\n\r\n`
            );
            const footerPart = Buffer.from(`\r\n--${boundary}--\r\n`);
            const totalSize = headerPart.length + fileSize + footerPart.length;

            return new Promise((resolve) => {
                const req = https.request(`${POKKIT_BASE}/upload`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': `multipart/form-data; boundary=${boundary}`,
                        'Content-Length': totalSize,
                        'Authorization': `Bearer ${token}`,
                    },
                    timeout: 600000,
                }, (res) => {
                    const chunks = [];
                    res.on('data', (c) => chunks.push(c));
                    res.on('end', () => {
                        const body = Buffer.concat(chunks).toString('utf-8');
                        if (res.statusCode === 401) return resolve({ success: false, error: 'unauthorized' });
                        if (res.statusCode >= 400) return resolve({ success: false, error: `HTTP ${res.statusCode}: ${body.slice(0, 120)}` });
                        try {
                            const json = JSON.parse(body);
                            if (!json.id) return resolve({ success: false, error: 'no id in upload response' });
                            resolve({ success: true, data: { url: `${POKKIT_BASE}/photos/${json.id}/video.mp4`, id: json.id } });
                        } catch (e) {
                            resolve({ success: false, error: `Invalid response: ${e.message}` });
                        }
                    });
                });
                req.on('error', (e) => resolve({ success: false, error: e.message }));
                req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Upload timeout' }); });
                req.write(headerPart);
                const rs = fs.createReadStream(filePath);
                let uploaded = 0;
                rs.on('data', (chunk) => {
                    req.write(chunk);
                    uploaded += chunk.length;
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('upload-progress', { filePath, pct: Math.round((uploaded / fileSize) * 100) });
                    }
                });
                rs.on('end', () => { req.write(footerPart); req.end(); });
                rs.on('error', (e) => { req.destroy(); resolve({ success: false, error: e.message }); });
            });
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('select-video-for-upload', async () => {
        if (!mainWindow) return { success: false, error: 'No window' };
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'Video', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] }
            ]
        });
        if (result.canceled || !result.filePaths.length) {
            return { success: false, canceled: true };
        }
        return { success: true, filePaths: result.filePaths };
    });
}

// --- File association / "Open with" support ---
// Video extensions ReVid can play directly. Keep in sync with the renderer
// (useVideoFileSystem) and getFilesInDirectory in preload.cjs.
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];

const isVideoFile = (filePath) =>
    !!filePath && VIDEO_EXTENSIONS.includes(path.extname(filePath).toLowerCase());

// Push a .revid collection to the renderer (theater import).
const handleRevidFileOpen = (filePath) => {
    if (!filePath || !filePath.endsWith('.revid')) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content);
            mainWindow.webContents.send('open-revid-file', { filePath, data });
        } catch {}
    }
};

// Push a plain video file to the renderer so it plays that exact file
// (and loads its folder for next/prev), instead of falling back to the
// last-used folder / Desktop.
const handleVideoFileOpen = (filePath) => {
    if (!isVideoFile(filePath)) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('open-video-file', { filePath });
    }
};

// Route an opened file to the right handler by extension (renderer must be ready).
const dispatchFileOpen = (filePath) => {
    if (filePath.endsWith('.revid')) handleRevidFileOpen(filePath);
    else if (isVideoFile(filePath)) handleVideoFileOpen(filePath);
};

// Open a file now if the window's renderer is ready; otherwise queue it so the
// did-finish-load handler can deliver it once the IPC listeners are wired. This
// closes a race where a second-instance file arrives mid-startup and the
// 'open-video-file' message would be dropped.
const handleFileOpen = (filePath) => {
    if (!filePath) return;
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
        dispatchFileOpen(filePath);
    } else {
        app._pendingOpenFile = filePath;
    }
};

// Find the first openable file (video or .revid) in a process argv array.
// Skips Electron/Chromium flags (anything starting with "-") and the exe path.
const findOpenableFileInArgs = (argv) => {
    for (const arg of argv.slice(1)) {
        if (!arg || arg.startsWith('-')) continue;
        if ((arg.endsWith('.revid') || isVideoFile(arg)) && fs.existsSync(arg)) {
            return arg;
        }
    }
    return null;
};

// Deliver the file the app was launched with (argv on Windows/Linux, or a
// queued macOS open-file). Driven by the renderer's 'renderer-ready' signal so
// it fires the instant React has wired its IPC listeners — no fixed delay — with
// a timed fallback in did-finish-load. Idempotent: runs at most once.
let initialFileHandled = false;
const flushInitialFile = () => {
    if (initialFileHandled) return;
    const target = app._pendingOpenFile || findOpenableFileInArgs(process.argv);
    if (!target) return;
    initialFileHandled = true;
    app._pendingOpenFile = null;
    dispatchFileOpen(target);
};

// Single-instance lock: when a file is "opened with" ReVid while it is already
// running, Windows/Linux launch a second process. Forward that file to the
// existing window and focus it instead of spawning a duplicate app.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', (_event, argv) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
        const target = findOpenableFileInArgs(argv);
        if (target) handleFileOpen(target);
    });
}

// macOS: open-file event (covers both initial launch and already-running app)
app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
        handleFileOpen(filePath);
    } else {
        // Store for when the window is ready
        app._pendingOpenFile = filePath;
    }
});

app.whenReady().then(async () => {
    // Resolve the renderer origin: Vite in dev, a loopback static server when
    // packaged (a real http origin so the YouTube IFrame API works — file://
    // yields a "null" origin that YouTube rejects with error 153).
    if (app.isPackaged) {
        try {
            rendererBaseUrl = await startRendererServer();
        } catch (e) {
            console.error('[renderer-server] failed, falling back to file://:', e?.message || e);
            rendererBaseUrl = `file://${path.join(__dirname, '../dist/index.html')}`;
        }
    } else {
        rendererBaseUrl = 'http://localhost:3001';
    }

    // local-video:// protocol handler with range request support
    registerLocalVideoProtocol(protocol);

    setupIpcHandlers();
    createWindow();
    setupAutoUpdater();

    // Warm the hardware-encoder probe so the first export doesn't stall on it.
    getH264Encoder();

    // Reclaim transcription temp files abandoned by a crash or a hard stop
    // (an interrupted run leaves a wav of ~2MB per minute of video).
    cleanupWhisperTemp();

    // Make the bundled plugins available on first run.
    try {
        pluginHost.seedBundledPlugins(path.join(__dirname, '..'));
    } catch (e) {
        console.error('[plugins] seeding failed:', e?.message || e);
    }

    // After the window loads, open any file passed on the command line (Windows/
    // Linux) or queued from a macOS open-file event before the window existed.
    // Fallback in case the renderer-ready signal never arrives (it normally
    // fires first and opens the file with no wait).
    mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(flushInitialFile, 800);
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// Let any in-flight theater-data write finish before the process exits,
// otherwise the atomic tmp→rename sequence can be cut off mid-way.
// will-quit (not before-quit) fires after all windows have closed, so the
// renderer's pagehide flush has already been delivered and sits on the chain.
// The timeout bounds a hung write so quitting can never wedge the app.
let quitFlushed = false;
app.on('will-quit', (event) => {
    if (quitFlushed) return;
    quitFlushed = true;
    event.preventDefault();
    killAllFfmpegJobs(); // don't leave orphaned encoders behind
    Promise.race([
        Promise.allSettled([drainTheaterSaves(), drainSyncRequests()]),
        new Promise((resolve) => setTimeout(resolve, 2000)),
    ]).finally(() => app.quit());
});
