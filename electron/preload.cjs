const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Video path the app was launched to open ("Open with ReVid"), injected by the
// main process via webPreferences.additionalArguments. Available synchronously
// at first render so the renderer can boot straight into the player.
const INITIAL_OPEN_FILE = (() => {
    const prefix = '--revid-open=';
    const arg = process.argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : null;
})();

const USER_DATA_DIR = (() => {
    const prefix = '--revid-userdata=';
    const arg = process.argv.find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : null;
})();

// Mirrors whisper-runner's cache key: subtitles land here when the video's own
// folder can't be written to, and must still be found on the next open.
function cachedSubtitlePath(videoPath, suffix) {
    if (!USER_DATA_DIR) return null;
    let size = 0;
    try { size = fs.statSync(videoPath).size; } catch (e) { /* gone */ }
    let h = 0;
    const s = `${path.resolve(videoPath).toLowerCase()}:${size}`;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return path.join(USER_DATA_DIR, 'subtitle-cache', `${(h >>> 0).toString(36)}-${size}${suffix}`);
}

// 鴨鴨家族面板（family-kit）：清單 / 安裝 / 開啟 / 前往下載 / 下載進度
contextBridge.exposeInMainWorld('familyKit', {
    list: (options) => ipcRenderer.invoke('family:list', options),
    install: (id) => ipcRenderer.invoke('family:install', String(id)),
    open: (id) => ipcRenderer.invoke('family:open', String(id)),
    page: (id) => ipcRenderer.invoke('family:page', String(id)),
    onProgress: (callback) => {
        const handler = (_event, progress) => callback(progress);
        ipcRenderer.on('family:progress', handler);
        return () => ipcRenderer.removeListener('family:progress', handler);
    },
});

contextBridge.exposeInMainWorld('electronAPI', {
    initialOpenFile: INITIAL_OPEN_FILE,

    openVideo: () => ipcRenderer.invoke('open-video'),

    selectDirectory: () => ipcRenderer.invoke('select-directory'),

    getFilesInDirectory: (dirPath, extensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv']) => {
        try {
            const files = fs.readdirSync(dirPath);
            return files
                .filter(file => extensions.includes(path.extname(file).toLowerCase()))
                // Replace-in-place working files must never surface as videos.
                .filter(file => !/\.revid-(tmp|bak)(\.[^.]+)?$/i.test(file))
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                .map(file => path.join(dirPath, file));
        } catch (e) {
            return [];
        }
    },

    // Season folders under a show folder. Used to tell "empty" apart from
    // "holds seasons", which look identical to a video listing.
    listSubfoldersWithVideos: (dirPath, extensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v']) => {
        try {
            return fs.readdirSync(dirPath, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => path.join(dirPath, d.name))
                .filter(sub => {
                    try {
                        return fs.readdirSync(sub)
                            .some(f => extensions.includes(path.extname(f).toLowerCase()));
                    } catch (e) {
                        return false;
                    }
                })
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        } catch (e) {
            return [];
        }
    },

    // Enough to walk the tree in place. Re-picking through the OS dialog for
    // every hop is the thing this replaces.
    folderNav: (dirPath, extensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v']) => {
        const hasVideos = (dir) => {
            try {
                return fs.readdirSync(dir).some(f => extensions.includes(path.extname(f).toLowerCase()));
            } catch (e) {
                return false;
            }
        };
        try {
            const parent = path.dirname(dirPath);
            const children = fs.readdirSync(dirPath, { withFileTypes: true })
                .filter(d => d.isDirectory() && !d.name.startsWith('.'))
                .map(d => {
                    const full = path.join(dirPath, d.name);
                    return { name: d.name, path: full, hasVideos: hasVideos(full) };
                })
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
            return {
                current: dirPath,
                // At a drive root, dirname returns the same path.
                parent: parent && parent !== dirPath ? parent : null,
                children
            };
        } catch (e) {
            return { current: dirPath, parent: null, children: [] };
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

    // Batched, async variant — one IPC round-trip for a whole folder
    getFileStats: async (filePaths) => {
        return await ipcRenderer.invoke('get-file-stats', filePaths);
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
        // The editor's background export has its own channel so its progress
        // never interleaves with BatchCropDialog's (both use this handler).
        const channel = params.opId === 'editor-export' ? 'editor-export-progress' : 'crop-progress';
        const handler = (_event, pct) => onProgress(pct);
        ipcRenderer.on(channel, handler);
        try {
            return await ipcRenderer.invoke('crop-video', params);
        } finally {
            ipcRenderer.removeListener(channel, handler);
        }
    },

    // Batch cut: scan a set of videos for the position of a template segment.
    findSegmentMatches: async (params, onProgress) => {
        const handler = (_event, payload) => onProgress(payload);
        ipcRenderer.on('segment-scan-progress', handler);
        try {
            return await ipcRenderer.invoke('find-segment-matches', params);
        } finally {
            ipcRenderer.removeListener('segment-scan-progress', handler);
        }
    },

    // Batch cut: trim each file to [0, cutAt). onFileEvent gets structured
    // {index, path, phase} events; onPct gets the active file's percentage.
    batchCutVideos: async (params, onFileEvent, onPct) => {
        const fileHandler = (_event, payload) => onFileEvent(payload);
        const pctHandler = (_event, pct) => onPct(pct);
        ipcRenderer.on('batch-cut-progress', fileHandler);
        ipcRenderer.on('batch-cut-progress-pct', pctHandler);
        try {
            return await ipcRenderer.invoke('batch-cut-videos', params);
        } finally {
            ipcRenderer.removeListener('batch-cut-progress', fileHandler);
            ipcRenderer.removeListener('batch-cut-progress-pct', pctHandler);
        }
    },

    // --- Whisper auto-subtitles ---

    whisperStatus: () => ipcRenderer.invoke('whisper-status'),

    whisperSetup: async (params, onProgress) => {
        const handler = (_event, p) => onProgress(p);
        ipcRenderer.on('whisper-setup-progress', handler);
        try {
            return await ipcRenderer.invoke('whisper-setup', params);
        } finally {
            ipcRenderer.removeListener('whisper-setup-progress', handler);
        }
    },

    // Background-transcribe the whole folder; progress via onQueueEvent.
    queueFolderTranscriptions: (videoPaths) =>
        ipcRenderer.invoke('queue-folder-transcriptions', { videoPaths }),

    clearTranscriptionQueue: () => ipcRenderer.invoke('clear-transcription-queue'),

    retranscribeVideo: async (videoPath, onEvent) => {
        const handler = (_event, payload) => {
            if (payload.videoPath === videoPath) onEvent?.(payload);
        };
        ipcRenderer.on('whisper-event', handler);
        try {
            return await ipcRenderer.invoke('retranscribe-video', { videoPath });
        } finally {
            ipcRenderer.removeListener('whisper-event', handler);
        }
    },

    onTranscriptionQueue: (callback) => {
        const handler = (_event, payload) => callback(payload);
        ipcRenderer.on('whisper-queue', handler);
        return () => ipcRenderer.removeListener('whisper-queue', handler);
    },

    transcribeVideo: async (videoPath, onEvent) => {
        const handler = (_event, payload) => {
            if (payload.videoPath === videoPath) onEvent(payload);
        };
        ipcRenderer.on('whisper-event', handler);
        try {
            return await ipcRenderer.invoke('transcribe-video', { videoPath });
        } finally {
            ipcRenderer.removeListener('whisper-event', handler);
        }
    },

    // Subtitles come from the folder's .revid library, falling back to any
    // sidecar the user brought along. Async because the main process owns
    // the library file.
    readSubtitleCues: (videoPath) => ipcRenderer.invoke('read-subtitles', { videoPath }),
    readChapters: (videoPath) => ipcRenderer.invoke('read-chapters', { videoPath }),
    exportSrt: (videoPath, translated) => ipcRenderer.invoke('export-srt', { videoPath, translated }),
    ensureLibrary: (folder) => ipcRenderer.invoke('ensure-library', { folder }),

    // Legacy sidecar readers, still used by the export dialog.
    readSubtitles: (videoPath) => {
        try {
            const base = videoPath.replace(/\.[^.]+$/, '');
            for (const ext of ['.srt', '.vtt']) {
                const p = base + ext;
                if (fs.existsSync(p)) {
                    return { path: p, format: ext.slice(1), content: fs.readFileSync(p, 'utf8') };
                }
            }
            const cached = cachedSubtitlePath(videoPath, '.srt');
            if (cached && fs.existsSync(cached)) {
                return { path: cached, format: 'srt', content: fs.readFileSync(cached, 'utf8') };
            }
        } catch (e) { /* unreadable */ }
        return null;
    },

    // Previously translated sidecar (<video>.zh.srt), else the cache copy.
    readTranslatedSubtitles: (videoPath) => {
        try {
            const p = `${videoPath.replace(/\.[^.]+$/, '')}.zh.srt`;
            if (fs.existsSync(p)) {
                return { path: p, format: 'srt', content: fs.readFileSync(p, 'utf8') };
            }
            const cached = cachedSubtitlePath(videoPath, '.zh.srt');
            if (cached && fs.existsSync(cached)) {
                return { path: cached, format: 'srt', content: fs.readFileSync(cached, 'utf8') };
            }
        } catch (e) { /* unreadable */ }
        return null;
    },

    translateSubtitles: async (params, onProgress) => {
        const handler = (_event, p) => {
            if (p.videoPath === params.videoPath) onProgress(p.pct);
        };
        ipcRenderer.on('translate-progress', handler);
        try {
            return await ipcRenderer.invoke('translate-subtitles', params);
        } finally {
            ipcRenderer.removeListener('translate-progress', handler);
        }
    },

    // --- Watch on another device ---

    lanStart: (folder) => ipcRenderer.invoke('lan-start', { folder }),
    lanStop: () => ipcRenderer.invoke('lan-stop'),
    lanStatus: () => ipcRenderer.invoke('lan-status'),
    lanRotate: () => ipcRenderer.invoke('lan-rotate'),

    // --- Offline dictionary ---

    dictLookup: (word) => ipcRenderer.invoke('dict-lookup', { word }),
    dictMarkDifficult: (lines, options) => ipcRenderer.invoke('dict-mark-difficult', { lines, options }),
    dictWordBank: (cues, options) => ipcRenderer.invoke('dict-word-bank', { cues, options }),

    savePdf: (data, defaultName) => ipcRenderer.invoke('save-pdf', { data, defaultName }),
    saveTextFile: (data, defaultName) => ipcRenderer.invoke('save-text-file', { data, defaultName }),
    cutRanges: async (params, onProgress) => {
        const handler = (_event, pct) => onProgress?.(pct);
        ipcRenderer.on('cut-ranges-progress', handler);
        try {
            return await ipcRenderer.invoke('cut-ranges', params);
        } finally {
            ipcRenderer.removeListener('cut-ranges-progress', handler);
        }
    },

    renderReel: async (params, onProgress) => {
        const handler = (_event, p) => onProgress?.(p);
        ipcRenderer.on('render-reel-progress', handler);
        try {
            return await ipcRenderer.invoke('render-reel', params);
        } finally {
            ipcRenderer.removeListener('render-reel-progress', handler);
        }
    },
    reelRendererStatus: () => ipcRenderer.invoke('reel-renderer-status'),
    searchSubtitles: (params) => ipcRenderer.invoke('search-subtitles', params),
    importEpisodeGuide: (folder, show) => ipcRenderer.invoke('import-episode-guide', { folder, show }),
    askEpisodes: (params) => ipcRenderer.invoke('ask-episodes', params),
    libraryGuides: (folder) => ipcRenderer.invoke('library-guides', { folder }),
    setFolderFollow: (folder, on) => ipcRenderer.invoke('set-folder-follow', { folder, on }),
    markFolderCut: (folder, note) => ipcRenderer.invoke('mark-folder-cut', { folder, note }),
    setAutoNext: (folder, on) => ipcRenderer.invoke('set-auto-next', { folder, on }),
    getAutoNext: (folder) => ipcRenderer.invoke('get-auto-next', { folder }),
    getFolderFollow: (folder) => ipcRenderer.invoke('get-folder-follow', { folder }),
    showSeasons: (folder) => ipcRenderer.invoke('show-seasons', { folder }),
    importShow: (folder, show, lang) => ipcRenderer.invoke('import-show', { folder, show, lang }),

    saveSubtitles: (videoPath, cues, translated) =>
        ipcRenderer.invoke('save-subtitles', { videoPath, cues, translated }),
    revealInFolder: (target) => ipcRenderer.invoke('open-path', { target }),

    // --- Plugins ---

    pluginsList: () => ipcRenderer.invoke('plugins-list'),
    pluginSetEnabled: (id, enabled) => ipcRenderer.invoke('plugin-set-enabled', { id, enabled }),
    pluginInstall: () => ipcRenderer.invoke('plugin-install'),
    pluginUninstall: (id) => ipcRenderer.invoke('plugin-uninstall', { id }),
    pluginsOpenFolder: () => ipcRenderer.invoke('plugins-open-folder'),

    startDrag: (filePath) => {
        ipcRenderer.send('start-drag', filePath);
    },

    // Kill all running ffmpeg jobs of one operation, e.g. cancelFfmpeg('create-gif').
    // Tool dialogs call this when closed mid-encode.
    cancelFfmpeg: async (op) => {
        return await ipcRenderer.invoke('cancel-ffmpeg', op);
    },

    // Rename-in-place only: both paths must resolve to the same directory,
    // so this can't be used to move files anywhere else on disk.
    renameFile: (oldPath, newPath) => {
        try {
            const oldDir = path.resolve(path.dirname(oldPath));
            const newDir = path.resolve(path.dirname(newPath));
            if (oldDir.toLowerCase() !== newDir.toLowerCase()) {
                return { success: false, error: 'Rename must stay in the same directory' };
            }
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

    // --- Always on Top API ---

    setAlwaysOnTop: async (value) => {
        return await ipcRenderer.invoke('set-always-on-top', value);
    },

    getAlwaysOnTop: async () => {
        return await ipcRenderer.invoke('get-always-on-top');
    },

    // --- Thumbnail API ---

    fetchThumbnail: async (url, courseId) => {
        if (!url || !courseId) return { success: false, error: 'Missing params' };
        return await ipcRenderer.invoke('fetch-thumbnail', { url, courseId });
    },

    // --- Video Download API ---

    downloadVideo: async (url, filename) => {
        return await ipcRenderer.invoke('download-video', { url, filename });
    },

    onDownloadProgress: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('download-progress', handler);
        return () => ipcRenderer.removeListener('download-progress', handler);
    },

    // --- Theater Data Persistence (file-based) ---

    loadTheaterData: async () => {
        return await ipcRenderer.invoke('load-theater-data');
    },

    saveTheaterData: async (data) => {
        return await ipcRenderer.invoke('save-theater-data', data);
    },

    // --- Cloud Sync (docs/SYNC-API.md) ---

    // { baseUrl, method, route, token, body } → { success, data | code, error }
    syncRequest: (req) => ipcRenderer.invoke('sync-request', req),
    loadSyncState: () => ipcRenderer.invoke('load-sync-state'),
    saveSyncState: (state) => ipcRenderer.invoke('save-sync-state', state),

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

    // --- .revid File API ---

    writeRevidFile: async (filePath, data) => {
        return await ipcRenderer.invoke('write-revid-file', { filePath, data });
    },

    writeRevidFilesBatch: async (dirPath, files) => {
        return await ipcRenderer.invoke('write-revid-files-batch', { dirPath, files });
    },

    readRevidFile: async (filePath) => {
        return await ipcRenderer.invoke('read-revid-file', filePath);
    },

    selectRevidFile: async () => {
        return await ipcRenderer.invoke('select-revid-file');
    },

    saveRevidFileDialog: async (defaultName) => {
        return await ipcRenderer.invoke('save-revid-file-dialog', defaultName);
    },

    exportTheaterData: async (data, defaultName) => {
        return await ipcRenderer.invoke('export-theater-data', { data, defaultName });
    },

    importTheaterData: async () => {
        return await ipcRenderer.invoke('import-theater-data');
    },

    // --- Upload API ---

    uploadVideoFile: async (filePath, config, onProgress) => {
        const handler = (_event, data) => {
            if (data.filePath === filePath) onProgress(data.pct);
        };
        ipcRenderer.on('upload-progress', handler);
        try {
            return await ipcRenderer.invoke('upload-video-file', { filePath, config });
        } finally {
            ipcRenderer.removeListener('upload-progress', handler);
        }
    },

    // Upload to the user's pokkit account (login-gated via LetMeUse Bearer token).
    uploadToPokkit: async (filePath, token, onProgress) => {
        const handler = (_event, data) => {
            if (data.filePath === filePath && onProgress) onProgress(data.pct);
        };
        ipcRenderer.on('upload-progress', handler);
        try {
            return await ipcRenderer.invoke('upload-to-pokkit', { filePath, token });
        } finally {
            ipcRenderer.removeListener('upload-progress', handler);
        }
    },

    selectVideoForUpload: async () => {
        return await ipcRenderer.invoke('select-video-for-upload');
    },

    // --- .revid File Association ---

    onOpenRevidFile: (callback) => {
        ipcRenderer.on('open-revid-file', (_event, payload) => callback(payload));
    },

    // Fired when a plain video file is opened via the OS ("Open with ReVid" /
    // double-click), so the renderer can play that exact file.
    onOpenVideoFile: (callback) => {
        ipcRenderer.on('open-video-file', (_event, payload) => callback(payload));
    },

    // --- A URL sent over from the browser extension ---
    onGrabUrl: (callback) => {
        const fn = (_event, payload) => callback(payload);
        ipcRenderer.on('grab-url', fn);
        return () => ipcRenderer.removeListener('grab-url', fn);
    },
    grabStatus: () => ipcRenderer.invoke('grab-status'),
    grabRotate: () => ipcRenderer.invoke('grab-rotate'),

    // Tell the main process the renderer has mounted and registered its file-open
    // listeners, so a launch file can be delivered immediately.
    notifyReady: () => ipcRenderer.send('renderer-ready'),

    // Fetch a YouTube video's real title (music-album song names).
    fetchYouTubeTitle: (url) => ipcRenderer.invoke('fetch-youtube-title', url),

    // Shrink the whole window to a floating music mini-panel (or restore it).
    setMusicMini: (enter) => ipcRenderer.invoke('set-music-mini', enter),

    // Custom title-bar window controls (frameless window).
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),

    isElectron: true
});
