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
            webSecurity: false
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

function setupIpcHandlers() {
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
}

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

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
