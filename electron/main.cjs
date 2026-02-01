const { app, BrowserWindow, Menu, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

// Enable WebCodecs
app.commandLine.appendSwitch('enable-features', 'WebCodecs,WebCodecsEncoder,WebCodecsDecoder');

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
            filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mov'] }]
        });
        if (result.canceled || !result.filePaths.length) return null;
        return result.filePaths[0];
    });

    // Save video buffer to file
    ipcMain.handle('save-video-buffer', async (_event, { filePath, arrayBuffer }) => {
        try {
            const MAX_SIZE = 500 * 1024 * 1024;
            if (arrayBuffer.byteLength > MAX_SIZE) {
                return { success: false, error: 'Video too large (max 500MB)' };
            }
            fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Show save dialog for video
    ipcMain.handle('show-save-dialog', async (_event, defaultPath) => {
        if (!mainWindow) return { canceled: true };
        return await dialog.showSaveDialog(mainWindow, {
            defaultPath,
            filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
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
