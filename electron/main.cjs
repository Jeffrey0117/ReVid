const { app, BrowserWindow, Menu, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

// Register local-video:// protocol for range-request support
protocol.registerSchemesAsPrivileged([
    { scheme: 'local-video', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true } }
]);

let mainWindow = null;
let miniPlayerWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        title: 'ReVid',
        backgroundColor: '#000000',
        icon: path.join(__dirname, '../revid.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            webSecurity: false,
            webviewTag: true
        }
    });

    Menu.setApplicationMenu(null);

    const isDev = !app.isPackaged;
    if (isDev) {
        mainWindow.loadURL('http://localhost:3001');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

// Get path for theater data file
function getTheaterDataPath() {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'theater-data.json');
}

function setupIpcHandlers() {
    // Theater data persistence (file-based, not localStorage)
    ipcMain.handle('load-theater-data', async () => {
        try {
            const dataPath = getTheaterDataPath();
            if (fs.existsSync(dataPath)) {
                const data = fs.readFileSync(dataPath, 'utf-8');
                return JSON.parse(data);
            }
            return null;
        } catch (e) {
            console.error('[load-theater-data] Error:', e);
            return null;
        }
    });

    ipcMain.handle('save-theater-data', async (_event, data) => {
        try {
            const dataPath = getTheaterDataPath();
            fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
            return { success: true };
        } catch (e) {
            console.error('[save-theater-data] Error:', e);
            return { success: false, error: e.message };
        }
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

    // Extract screenshots from video at intervals
    ipcMain.handle('extract-screenshots', async (_event, params) => {
        const { inputPath, outputDir, interval, format, totalDuration } = params;
        const ext = format === 'png' ? 'png' : 'jpg';
        const baseName = path.basename(inputPath, path.extname(inputPath));
        const outputPattern = path.join(outputDir, `${baseName}_%04d.${ext}`);

        const args = [
            '-y',
            '-i', inputPath,
            '-vf', `fps=1/${interval}`,
        ];

        if (ext === 'png') {
            args.push('-compression_level', '3');
        } else {
            args.push('-q:v', '2');
        }

        args.push('-progress', 'pipe:1');
        args.push(outputPattern);

        const totalUs = (totalDuration || 1) * 1_000_000;

        return new Promise((resolve) => {
            const proc = spawn(ffmpegPath, args);

            proc.stdout.on('data', (data) => {
                const str = data.toString();
                const match = str.match(/out_time_us=(\d+)/);
                if (match && mainWindow) {
                    const pct = Math.min(100, Math.round((parseInt(match[1]) / totalUs) * 100));
                    mainWindow.webContents.send('screenshot-progress', pct);
                }
            });

            proc.stderr.on('data', () => {});

            proc.on('close', (code) => {
                // Count output files
                try {
                    const outputFiles = fs.readdirSync(outputDir)
                        .filter(f => f.startsWith(baseName + '_') && f.endsWith(`.${ext}`));
                    if (code === 0) {
                        resolve({ success: true, count: outputFiles.length });
                    } else {
                        resolve({ success: false, error: `ffmpeg exited with code ${code}`, count: outputFiles.length });
                    }
                } catch (e) {
                    resolve({ success: code === 0, count: 0, error: code !== 0 ? `ffmpeg exited with code ${code}` : undefined });
                }
            });

            proc.on('error', (err) => {
                resolve({ success: false, error: err.message, count: 0 });
            });
        });
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

        const totalUs = duration * 1_000_000;

        return new Promise((resolve) => {
            const proc = spawn(ffmpegPath, args);

            proc.stdout.on('data', (data) => {
                const str = data.toString();
                const match = str.match(/out_time_us=(\d+)/);
                if (match && mainWindow) {
                    const pct = Math.min(100, Math.round((parseInt(match[1]) / totalUs) * 100));
                    mainWindow.webContents.send('gif-progress', pct);
                }
            });

            proc.stderr.on('data', () => {});

            proc.on('close', (code) => {
                if (code === 0) {
                    try {
                        const stat = fs.statSync(outputPath);
                        resolve({ success: true, fileSize: stat.size });
                    } catch {
                        resolve({ success: true, fileSize: 0 });
                    }
                } else {
                    resolve({ success: false, error: `ffmpeg exited with code ${code}` });
                }
            });

            proc.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
        });
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

        const totalUs = (totalDuration || 1) * 1_000_000;

        return new Promise((resolve) => {
            const proc = spawn(ffmpegPath, args);

            proc.stdout.on('data', (data) => {
                const str = data.toString();
                const match = str.match(/out_time_us=(\d+)/);
                if (match && mainWindow) {
                    const pct = Math.min(100, Math.round((parseInt(match[1]) / totalUs) * 100));
                    mainWindow.webContents.send('compress-progress', pct);
                }
            });

            proc.stderr.on('data', () => {});

            proc.on('close', (code) => {
                if (code === 0) {
                    try {
                        const stat = fs.statSync(outputPath);
                        resolve({ success: true, fileSize: stat.size });
                    } catch {
                        resolve({ success: true, fileSize: 0 });
                    }
                } else {
                    resolve({ success: false, error: `ffmpeg exited with code ${code}` });
                }
            });

            proc.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
        });
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

        const totalUs = (totalDuration || 1) * 1_000_000;

        return new Promise((resolve) => {
            const proc = spawn(ffmpegPath, args);

            proc.stdout.on('data', (data) => {
                const str = data.toString();
                const match = str.match(/out_time_us=(\d+)/);
                if (match && mainWindow) {
                    const pct = Math.min(100, Math.round((parseInt(match[1]) / totalUs) * 100));
                    mainWindow.webContents.send('audio-progress', pct);
                }
            });

            proc.stderr.on('data', () => {});

            proc.on('close', (code) => {
                if (code === 0) {
                    try {
                        const stat = fs.statSync(outputPath);
                        resolve({ success: true, fileSize: stat.size });
                    } catch {
                        resolve({ success: true, fileSize: 0 });
                    }
                } else {
                    resolve({ success: false, error: `ffmpeg exited with code ${code}` });
                }
            });

            proc.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
        });
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

        const totalUs = (totalDuration || 1) * 1_000_000;

        return new Promise((resolve) => {
            const proc = spawn(ffmpegPath, args);

            proc.stdout.on('data', (data) => {
                const str = data.toString();
                const match = str.match(/out_time_us=(\d+)/);
                if (match && mainWindow) {
                    const outputDur = totalDuration / speed;
                    const outputUs = outputDur * 1_000_000;
                    const pct = Math.min(100, Math.round((parseInt(match[1]) / outputUs) * 100));
                    mainWindow.webContents.send('speed-progress', pct);
                }
            });

            proc.stderr.on('data', () => {});

            proc.on('close', (code) => {
                if (code === 0) {
                    try {
                        const stat = fs.statSync(outputPath);
                        resolve({ success: true, fileSize: stat.size });
                    } catch {
                        resolve({ success: true, fileSize: 0 });
                    }
                } else {
                    resolve({ success: false, error: `ffmpeg exited with code ${code}` });
                }
            });

            proc.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
        });
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

        const totalUs = (totalDuration || 1) * 1_000_000;

        return new Promise((resolve) => {
            const proc = spawn(ffmpegPath, args);

            proc.stdout.on('data', (data) => {
                const str = data.toString();
                const match = str.match(/out_time_us=(\d+)/);
                if (match && mainWindow) {
                    const pct = Math.min(100, Math.round((parseInt(match[1]) / totalUs) * 100));
                    mainWindow.webContents.send('concat-progress', pct);
                }
            });

            proc.stderr.on('data', () => {});

            proc.on('close', (code) => {
                try { fs.unlinkSync(listPath); } catch {}
                if (code === 0) {
                    try {
                        const stat = fs.statSync(outputPath);
                        resolve({ success: true, fileSize: stat.size });
                    } catch {
                        resolve({ success: true, fileSize: 0 });
                    }
                } else {
                    resolve({ success: false, error: `ffmpeg exited with code ${code}` });
                }
            });

            proc.on('error', (err) => {
                try { fs.unlinkSync(listPath); } catch {}
                resolve({ success: false, error: err.message });
            });
        });
    });

    // Crop + trim video using ffmpeg (runs in main process)
    ipcMain.handle('crop-video', async (_event, params) => {
        const { inputPath, outputPath, crop, trim, totalDuration } = params;

        const args = ['-y'];

        if (trim) {
            args.push('-ss', String(trim.startTime), '-to', String(trim.endTime));
        }

        args.push('-i', inputPath);
        args.push('-vf', `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`);
        args.push('-c:v', 'libx264', '-crf', '18', '-preset', 'fast', '-pix_fmt', 'yuv420p');
        args.push('-c:a', 'copy');
        args.push('-progress', 'pipe:1');
        args.push(outputPath);

        const totalUs = (totalDuration || 1) * 1_000_000;

        return new Promise((resolve) => {
            const proc = spawn(ffmpegPath, args);

            proc.stdout.on('data', (data) => {
                const str = data.toString();
                const match = str.match(/out_time_us=(\d+)/);
                if (match && mainWindow) {
                    const pct = Math.min(100, Math.round((parseInt(match[1]) / totalUs) * 100));
                    mainWindow.webContents.send('crop-progress', pct);
                }
            });

            proc.stderr.on('data', () => {});

            proc.on('close', (code) => {
                if (code === 0) resolve({ success: true });
                else resolve({ success: false, error: `ffmpeg exited with code ${code}` });
            });

            proc.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
        });
    });

    // --- Mini Player IPC Handlers ---

    ipcMain.handle('mini-player-open', (event, options = {}) => {
        if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
            miniPlayerWindow.focus();
            miniPlayerWindow.webContents.send('mini-player-init', options);
            return { success: true, alreadyOpen: true };
        }

        const isDev = !app.isPackaged;
        const baseUrl = isDev ? 'http://localhost:3001' : `file://${path.join(__dirname, '../dist/index.html')}`;

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

        miniPlayerWindow.loadURL(`${baseUrl}${isDev ? '' : ''}?mode=mini-player`);

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

    // --- Always on Top ---

    ipcMain.handle('set-always-on-top', (_event, value) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(!!value);
            return { success: true, alwaysOnTop: !!value };
        }
        return { success: false };
    });

    ipcMain.handle('get-always-on-top', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            return { success: true, alwaysOnTop: mainWindow.isAlwaysOnTop() };
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

    // Run cleanup on startup
    cleanOldThumbnails();

    ipcMain.handle('fetch-thumbnail', async (_event, { url, courseId }) => {
        if (!url || !courseId) return { success: false, error: 'Missing url or courseId' };

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
                    if (code === 0) {
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

// --- .revid file association ---
// Handle file open from command line (Windows: double-click .revid)
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

// Windows: check process.argv for .revid file
const checkArgvForRevid = () => {
    const args = process.argv.slice(1);
    for (const arg of args) {
        if (arg.endsWith('.revid') && fs.existsSync(arg)) {
            // Delay to ensure window is ready
            setTimeout(() => handleRevidFileOpen(arg), 500);
            break;
        }
    }
};

// macOS: open-file event
app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (mainWindow) {
        handleRevidFileOpen(filePath);
    } else {
        // Store for when window is ready
        app._pendingRevidFile = filePath;
    }
});

app.whenReady().then(() => {
    // local-video:// protocol handler with range request support
    protocol.handle('local-video', (request) => {
        const url = new URL(request.url);
        let filePath = decodeURIComponent(url.pathname);
        if (process.platform === 'win32' && filePath.startsWith('/')) {
            filePath = filePath.slice(1);
        }

        try {
            const stat = fs.statSync(filePath);
            const fileSize = stat.size;
            const rangeHeader = request.headers.get('range');

            if (rangeHeader) {
                const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
                if (match) {
                    const start = parseInt(match[1], 10);
                    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
                    const chunkSize = end - start + 1;
                    const fd = fs.openSync(filePath, 'r');
                    const buf = Buffer.alloc(chunkSize);
                    fs.readSync(fd, buf, 0, chunkSize, start);
                    fs.closeSync(fd);

                    return new Response(buf, {
                        status: 206,
                        headers: {
                            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                            'Accept-Ranges': 'bytes',
                            'Content-Length': String(chunkSize),
                            'Content-Type': 'video/mp4'
                        }
                    });
                }
            }

            return new Response(fs.readFileSync(filePath), {
                status: 200,
                headers: {
                    'Content-Length': String(fileSize),
                    'Content-Type': 'video/mp4',
                    'Accept-Ranges': 'bytes'
                }
            });
        } catch (e) {
            return new Response('File not found', { status: 404 });
        }
    });

    setupIpcHandlers();
    createWindow();

    // Check for .revid file in argv after window loads
    mainWindow.webContents.once('did-finish-load', () => {
        checkArgvForRevid();
        // macOS: handle pending file
        if (app._pendingRevidFile) {
            handleRevidFileOpen(app._pendingRevidFile);
            app._pendingRevidFile = null;
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
