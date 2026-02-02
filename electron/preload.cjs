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

    selectOutputDirectory: () => ipcRenderer.invoke('select-output-directory'),

    extractScreenshots: async (params, onProgress) => {
        const handler = (_event, pct) => onProgress(pct);
        ipcRenderer.on('screenshot-progress', handler);
        try {
            return await ipcRenderer.invoke('extract-screenshots', params);
        } finally {
            ipcRenderer.removeListener('screenshot-progress', handler);
        }
    },

    compressVideo: async (params, onProgress) => {
        const handler = (_event, pct) => onProgress(pct);
        ipcRenderer.on('compress-progress', handler);
        try {
            return await ipcRenderer.invoke('compress-video', params);
        } finally {
            ipcRenderer.removeListener('compress-progress', handler);
        }
    },

    extractAudio: async (params, onProgress) => {
        const handler = (_event, pct) => onProgress(pct);
        ipcRenderer.on('audio-progress', handler);
        try {
            return await ipcRenderer.invoke('extract-audio', params);
        } finally {
            ipcRenderer.removeListener('audio-progress', handler);
        }
    },

    speedVideo: async (params, onProgress) => {
        const handler = (_event, pct) => onProgress(pct);
        ipcRenderer.on('speed-progress', handler);
        try {
            return await ipcRenderer.invoke('speed-video', params);
        } finally {
            ipcRenderer.removeListener('speed-progress', handler);
        }
    },

    concatVideos: async (params, onProgress) => {
        const handler = (_event, pct) => onProgress(pct);
        ipcRenderer.on('concat-progress', handler);
        try {
            return await ipcRenderer.invoke('concat-videos', params);
        } finally {
            ipcRenderer.removeListener('concat-progress', handler);
        }
    },

    createGif: async (params, onProgress) => {
        const handler = (_event, pct) => onProgress(pct);
        ipcRenderer.on('gif-progress', handler);
        try {
            return await ipcRenderer.invoke('create-gif', params);
        } finally {
            ipcRenderer.removeListener('gif-progress', handler);
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

    startDrag: (filePath) => {
        ipcRenderer.send('start-drag', filePath);
    },

    renameFile: (oldPath, newPath) => {
        try {
            fs.renameSync(oldPath, newPath);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    },

    path: {
        basename: (p, ext) => path.basename(p, ext),
        extname: (p) => path.extname(p),
        join: (...args) => path.join(...args),
        dirname: (p) => path.dirname(p)
    },

    // --- Mini Player API ---

    openMiniPlayer: async (options = {}) => {
        return await ipcRenderer.invoke('mini-player-open', options);
    },

    closeMiniPlayer: async () => {
        return await ipcRenderer.invoke('mini-player-close');
    },

    setMiniPlayerOpacity: async (opacity) => {
        if (typeof opacity !== 'number') return { success: false, error: 'Invalid opacity' };
        return await ipcRenderer.invoke('mini-player-set-opacity', opacity);
    },

    onMiniPlayerInit: (callback) => {
        ipcRenderer.on('mini-player-init', (_event, data) => callback(data));
    },

    onMiniPlayerUpdate: (callback) => {
        ipcRenderer.on('mini-player-update', (_event, data) => callback(data));
    },

    onMiniPlayerClosed: (callback) => {
        ipcRenderer.on('mini-player-closed', (_event) => callback());
    },

    sendTimeSync: (data) => {
        ipcRenderer.send('mini-player-time-sync', data);
    },

    sendToMiniPlayer: (data) => {
        ipcRenderer.send('mini-player-send', data);
    },

    // --- Theater Session API ---

    createPersistentSession: async (platform) => {
        if (!platform || typeof platform !== 'string') {
            return { success: false, error: 'Invalid platform' };
        }
        return await ipcRenderer.invoke('create-persistent-session', platform);
    },

    clearSession: async (platform) => {
        if (!platform || typeof platform !== 'string') {
            return { success: false, error: 'Invalid platform' };
        }
        return await ipcRenderer.invoke('clear-session', platform);
    },

    isElectron: true
});
