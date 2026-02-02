const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

contextBridge.exposeInMainWorld('electronAPI', {
    openVideo: () => ipcRenderer.invoke('open-video'),

    selectDirectory: () => ipcRenderer.invoke('select-directory'),

    getFilesInDirectory: (dirPath, extensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv']) => {
        try {
            const files = fs.readdirSync(dirPath);
            return files
                .filter(file => extensions.includes(path.extname(file).toLowerCase()))
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                .map(file => path.join(dirPath, file));
        } catch (e) {
            return [];
        }
    },

    getDesktopPath: () => path.join(os.homedir(), 'Desktop'),

    getFileSize: (filePath) => {
        try {
            const stat = fs.statSync(filePath);
            return stat.size;
        } catch (e) {
            return 0;
        }
    },

    getFileStat: (filePath) => {
        try {
            const stat = fs.statSync(filePath);
            return { size: stat.size, mtimeMs: stat.mtimeMs };
        } catch (e) {
            return { size: 0, mtimeMs: 0 };
        }
    },

    showSaveDialog: async (defaultPath) => {
        return await ipcRenderer.invoke('show-save-dialog', defaultPath);
    },

    cropVideo: async (params, onProgress) => {
        const handler = (_event, pct) => onProgress(pct);
        ipcRenderer.on('crop-progress', handler);
        try {
            return await ipcRenderer.invoke('crop-video', params);
        } finally {
            ipcRenderer.removeListener('crop-progress', handler);
        }
    },

    path: {
        basename: (p, ext) => path.basename(p, ext),
        extname: (p) => path.extname(p),
        join: (...args) => path.join(...args),
        dirname: (p) => path.dirname(p)
    },

    isElectron: true
});
