const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

contextBridge.exposeInMainWorld('electronAPI', {
    openVideo: () => ipcRenderer.invoke('open-video'),

    saveVideoBuffer: async (filePath, arrayBuffer) => {
        return await ipcRenderer.invoke('save-video-buffer', { filePath, arrayBuffer });
    },

    showSaveDialog: async (defaultPath) => {
        return await ipcRenderer.invoke('show-save-dialog', defaultPath);
    },

    path: {
        basename: (p, ext) => path.basename(p, ext),
        extname: (p) => path.extname(p),
        join: (...args) => path.join(...args),
        dirname: (p) => path.dirname(p)
    },

    isElectron: true
});
