const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

contextBridge.exposeInMainWorld('electronAPI', {
    openVideo: () => ipcRenderer.invoke('open-video'),

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
