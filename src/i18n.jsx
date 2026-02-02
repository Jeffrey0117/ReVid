import { useState, useCallback, useMemo, createContext, useContext } from 'react';

const LANG_KEY = 'revid-lang';

const translations = {
  en: {
    openFolder: 'Open Folder',
    videos: 'videos',
    switchToViewer: 'Switch to Viewer',
    switchToGrid: 'Switch to Grid',
    switchToBottom: 'Switch to Bottom',
    switchToLeft: 'Switch to Left',
    cropVideo: 'Crop Video',
    tools: 'Tools',
    screenshots: 'Screenshots',
    createGif: 'Create GIF',
    compress: 'Compress',
    extractAudio: 'Extract Audio',
    speedOutput: 'Speed Output',
    batchCrop: 'Batch Crop',
    batchRename: 'Batch Rename',
    concatVideos: 'Concat Videos',
    openFolderToBrowse: 'Open a folder to browse videos',
    supportsFormats: 'Supports MP4, WebM, MOV, AVI, MKV',
    saved: 'Saved!',
    ascending: 'Ascending',
    descending: 'Descending',
    allTypes: 'All types',
    showPinnedOnly: 'Show pinned only',
    showAll: 'Show all',
    name: 'Name',
    size: 'Size',
    date: 'Date',
    duration: 'Duration',
    // Screenshot dialog
    captureEvery: 'Capture every (seconds)',
    format: 'Format',
    outputFolder: 'Output folder',
    selectFolder: 'Select folder...',
    extractScreenshots: 'Extract Screenshots',
    extracting: 'Extracting screenshots...',
    extracted: 'Extracted',
    screenshotsWord: 'screenshots',
    savedTo: 'Saved to',
    failed: 'Failed',
    close: 'Close',
    // GIF dialog
    startSec: 'Start (seconds)',
    endSec: 'End (seconds)',
    total: 'total',
    creatingGif: 'Creating GIF...',
    gifCreated: 'GIF created',
    // Compress
    compressVideo: 'Compress Video',
    quality: 'Quality',
    resolution: 'Resolution',
    original: 'Original',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    min: 'Min',
    compressing: 'Compressing...',
    compressed: 'Compressed',
    // Audio
    extractAudioTitle: 'Extract Audio',
    extractingAudio: 'Extracting audio...',
    audioExtracted: 'Audio extracted',
    // Speed
    speedOutputTitle: 'Speed Output',
    speed: 'Speed',
    processing: 'Processing',
    exported: 'Exported',
    // Batch crop
    batchCropTitle: 'Batch Crop',
    cropAspectRatio: 'Crop aspect ratio (center crop)',
    deselectAll: 'Deselect All',
    selectAll: 'Select All',
    batchCropComplete: 'Batch crop complete',
    succeeded: 'succeeded',
    // Rename
    batchRenameTitle: 'Batch Rename',
    pattern: 'Pattern',
    namingConflict: 'Naming conflict detected',
    renamed: 'Renamed',
    files: 'files',
    // Concat
    concatTitle: 'Concat Videos',
    joiningVideos: 'Joining videos...',
    videosJoined: 'Videos joined',
    codecNote: 'Videos must have the same codec/resolution for stream copy.',
    available: 'Available:',
    // Theme
    darkMode: 'Dark Mode',
    lightMode: 'Light Mode',
    // Settings
    settings: 'Settings',
    about: 'About',
    changeLanguage: 'Language',
    appDescription: 'Video Browser & Editor',
    // Theater
    theater: 'Theater',
    theaterMode: 'Course Theater',
    courseFolder: 'Course Folder',
    addCourse: 'Add Course',
    addCourseUrl: 'Add Course URL',
    courseUrl: 'Course URL',
    courseTitle: 'Course Title (optional)',
    platformDetected: 'Platform: {platform}',
    openAndDetect: 'Open & Detect',
    deleteFolderConfirm: 'Delete this folder and all its courses?',
    deleteCourseConfirm: 'Remove this course?',
    courseProgress: '{percent}% completed',
    lastWatched: 'Last watched: {time}',
    loginPreserved: 'Login session preserved',
    clearSession: 'Clear login session',
    clearSessionConfirm: 'Clear login session for {platform}? You will need to log in again.',
    sessionCleared: 'Session cleared for {platform}',
    detectingVideo: 'Detecting video...',
    videoDetected: 'Video detected',
    noVideoFound: 'No video found on this page',
    focusMode: 'Focus mode active',
    courseTheater: 'Course Theater',
    courseTheaterHint: 'Add course URLs to watch with speed control and progress tracking',
    cancel: 'Cancel',
    emptyAlbum: 'This album is empty',
    selectOrCreateAlbum: 'Select or create a folder',
    miniPlayer: 'Mini Player',
    miniPlayerOpen: 'Open Mini Player',
    miniPlayerClose: 'Close Mini Player',
    miniPlayerOpacity: 'Opacity',
    // YouTube
    ytLoading: 'Loading YouTube player...',
    ytConnected: 'YouTube connected',
    ytConnecting: 'Connecting to YouTube...',
    ytError: 'YouTube playback error',
    ytInvalidUrl: 'Invalid YouTube URL',
    ytMaxSpeed: 'YouTube max: 2x'
  },
  'zh-TW': {
    openFolder: '\u958b\u555f\u8cc7\u6599\u593e',
    videos: '\u90e8\u5f71\u7247',
    switchToViewer: '\u5207\u63db\u5230\u64ad\u653e\u5668',
    switchToGrid: '\u5207\u63db\u5230\u7e2e\u5716',
    switchToBottom: '\u5207\u63db\u5230\u4e0b\u65b9',
    switchToLeft: '\u5207\u63db\u5230\u5de6\u5074',
    cropVideo: '\u88c1\u526a\u5f71\u7247',
    tools: '\u5de5\u5177',
    screenshots: '\u64f7\u53d6\u622a\u5716',
    createGif: '\u5efa\u7acb GIF',
    compress: '\u58d3\u7e2e',
    extractAudio: '\u63d0\u53d6\u97f3\u8a0a',
    speedOutput: '\u8f38\u51fa\u8abf\u901f',
    batchCrop: '\u6279\u6b21\u88c1\u526a',
    batchRename: '\u6279\u6b21\u91cd\u65b0\u547d\u540d',
    concatVideos: '\u5408\u4f75\u5f71\u7247',
    openFolderToBrowse: '\u958b\u555f\u8cc7\u6599\u593e\u4ee5\u700f\u89bd\u5f71\u7247',
    supportsFormats: '\u652f\u63f4 MP4, WebM, MOV, AVI, MKV',
    saved: '\u5df2\u5132\u5b58\uff01',
    ascending: '\u905e\u589e',
    descending: '\u905e\u6e1b',
    allTypes: '\u6240\u6709\u683c\u5f0f',
    showPinnedOnly: '\u53ea\u986f\u793a\u91d8\u9078',
    showAll: '\u986f\u793a\u5168\u90e8',
    name: '\u540d\u7a31',
    size: '\u5927\u5c0f',
    date: '\u65e5\u671f',
    duration: '\u6642\u9577',
    captureEvery: '\u6bcf\u5e7e\u79d2\u64f7\u53d6',
    format: '\u683c\u5f0f',
    outputFolder: '\u8f38\u51fa\u8cc7\u6599\u593e',
    selectFolder: '\u9078\u64c7\u8cc7\u6599\u593e...',
    extractScreenshots: '\u64f7\u53d6\u622a\u5716',
    extracting: '\u6b63\u5728\u64f7\u53d6\u622a\u5716...',
    extracted: '\u5df2\u64f7\u53d6',
    screenshotsWord: '\u5f35\u622a\u5716',
    savedTo: '\u5132\u5b58\u81f3',
    failed: '\u5931\u6557',
    close: '\u95dc\u9589',
    startSec: '\u958b\u59cb (\u79d2)',
    endSec: '\u7d50\u675f (\u79d2)',
    total: '\u7e3d\u9577',
    creatingGif: '\u6b63\u5728\u5efa\u7acb GIF...',
    gifCreated: 'GIF \u5efa\u7acb\u5b8c\u6210',
    compressVideo: '\u58d3\u7e2e\u5f71\u7247',
    quality: '\u54c1\u8cea',
    resolution: '\u89e3\u6790\u5ea6',
    original: '\u539f\u59cb',
    high: '\u9ad8',
    medium: '\u4e2d',
    low: '\u4f4e',
    min: '\u6700\u5c0f',
    compressing: '\u6b63\u5728\u58d3\u7e2e...',
    compressed: '\u5df2\u58d3\u7e2e',
    extractAudioTitle: '\u63d0\u53d6\u97f3\u8a0a',
    extractingAudio: '\u6b63\u5728\u63d0\u53d6\u97f3\u8a0a...',
    audioExtracted: '\u97f3\u8a0a\u5df2\u63d0\u53d6',
    speedOutputTitle: '\u8f38\u51fa\u8abf\u901f',
    speed: '\u901f\u5ea6',
    processing: '\u8655\u7406\u4e2d',
    exported: '\u5df2\u8f38\u51fa',
    batchCropTitle: '\u6279\u6b21\u88c1\u526a',
    cropAspectRatio: '\u88c1\u526a\u6bd4\u4f8b (\u7f6e\u4e2d\u88c1\u526a)',
    deselectAll: '\u53d6\u6d88\u5168\u9078',
    selectAll: '\u5168\u9078',
    batchCropComplete: '\u6279\u6b21\u88c1\u526a\u5b8c\u6210',
    succeeded: '\u6210\u529f',
    batchRenameTitle: '\u6279\u6b21\u91cd\u65b0\u547d\u540d',
    pattern: '\u6a21\u5f0f',
    namingConflict: '\u547d\u540d\u885d\u7a81',
    renamed: '\u5df2\u91cd\u65b0\u547d\u540d',
    files: '\u500b\u6a94\u6848',
    concatTitle: '\u5408\u4f75\u5f71\u7247',
    joiningVideos: '\u6b63\u5728\u5408\u4f75\u5f71\u7247...',
    videosJoined: '\u5f71\u7247\u5df2\u5408\u4f75',
    codecNote: '\u5f71\u7247\u9700\u8981\u76f8\u540c\u7684\u7de8\u78bc/\u89e3\u6790\u5ea6\u624d\u80fd\u76f4\u63a5\u5408\u4f75',
    available: '\u53ef\u7528\uff1a',
    darkMode: '\u6df1\u8272\u6a21\u5f0f',
    lightMode: '\u6dfa\u8272\u6a21\u5f0f',
    settings: '\u8a2d\u5b9a',
    about: '\u95dc\u65bc',
    changeLanguage: '\u8a9e\u8a00',
    appDescription: '\u5f71\u7247\u700f\u89bd\u5668\u8207\u7de8\u8f2f\u5668',
    // Theater
    theater: '\u8ab2\u7a0b\u5ef3',
    theaterMode: '\u865b\u64ec\u8ab2\u7a0b\u5ef3',
    courseFolder: '\u8ab2\u7a0b\u8cc7\u6599\u593e',
    addCourse: '\u65b0\u589e\u8ab2\u7a0b',
    addCourseUrl: '\u65b0\u589e\u8ab2\u7a0b\u7db2\u5740',
    courseUrl: '\u8ab2\u7a0b\u7db2\u5740',
    courseTitle: '\u8ab2\u7a0b\u540d\u7a31\uff08\u9078\u586b\uff09',
    platformDetected: '\u5e73\u53f0\uff1a{platform}',
    openAndDetect: '\u958b\u555f\u4e26\u5075\u6e2c',
    deleteFolderConfirm: '\u78ba\u5b9a\u522a\u9664\u6b64\u8cc7\u6599\u593e\u53ca\u6240\u6709\u8ab2\u7a0b\uff1f',
    deleteCourseConfirm: '\u78ba\u5b9a\u79fb\u9664\u6b64\u8ab2\u7a0b\uff1f',
    courseProgress: '\u5df2\u5b8c\u6210 {percent}%',
    lastWatched: '\u4e0a\u6b21\u89c0\u770b\uff1a{time}',
    loginPreserved: '\u767b\u5165\u72c0\u614b\u5df2\u4fdd\u7559',
    clearSession: '\u6e05\u9664\u767b\u5165\u72c0\u614b',
    clearSessionConfirm: '\u78ba\u5b9a\u6e05\u9664 {platform} \u7684\u767b\u5165\u72c0\u614b\uff1f\u4f60\u9700\u8981\u91cd\u65b0\u767b\u5165\u3002',
    sessionCleared: '\u5df2\u6e05\u9664 {platform} \u7684\u767b\u5165\u72c0\u614b',
    detectingVideo: '\u6b63\u5728\u5075\u6e2c\u5f71\u7247...',
    videoDetected: '\u5df2\u5075\u6e2c\u5230\u5f71\u7247',
    noVideoFound: '\u6b64\u9801\u9762\u672a\u627e\u5230\u5f71\u7247',
    focusMode: '\u5c08\u6ce8\u6a21\u5f0f\u5df2\u555f\u7528',
    courseTheater: '\u865b\u64ec\u8ab2\u7a0b\u5ef3',
    courseTheaterHint: '\u65b0\u589e\u8ab2\u7a0b\u7db2\u5740\uff0c\u4eab\u53d7\u901f\u5ea6\u63a7\u5236\u8207\u9032\u5ea6\u8ffd\u8e64',
    cancel: '\u53d6\u6d88',
    emptyAlbum: '\u6b64\u8cc7\u6599\u593e\u662f\u7a7a\u7684',
    selectOrCreateAlbum: '\u9078\u64c7\u6216\u5efa\u7acb\u4e00\u500b\u8cc7\u6599\u593e',
    miniPlayer: '\u8ff7\u4f60\u64ad\u653e\u5668',
    miniPlayerOpen: '\u958b\u555f\u8ff7\u4f60\u64ad\u653e\u5668',
    miniPlayerClose: '\u95dc\u9589\u8ff7\u4f60\u64ad\u653e\u5668',
    miniPlayerOpacity: '\u900f\u660e\u5ea6',
    // YouTube
    ytLoading: '\u6b63\u5728\u8f09\u5165 YouTube \u64ad\u653e\u5668...',
    ytConnected: 'YouTube \u5df2\u9023\u7dda',
    ytConnecting: '\u6b63\u5728\u9023\u7dda YouTube...',
    ytError: 'YouTube \u64ad\u653e\u932f\u8aa4',
    ytInvalidUrl: '\u7121\u6548\u7684 YouTube \u7db2\u5740',
    ytMaxSpeed: 'YouTube \u6700\u9ad8\uff1a2x'
  }
};

const I18nContext = createContext(null);

export const useI18n = () => {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback if outside provider
    return { t: (key) => translations.en[key] || key, lang: 'en', setLang: () => {} };
  }
  return ctx;
};

export const I18nProvider = ({ children }) => {
  const [lang, setLangState] = useState(() =>
    localStorage.getItem(LANG_KEY) || 'en'
  );

  const setLang = useCallback((newLang) => {
    setLangState(newLang);
    localStorage.setItem(LANG_KEY, newLang);
  }, []);

  const t = useCallback(
    (key) => translations[lang]?.[key] || translations.en[key] || key,
    [lang]
  );

  const value = useMemo(() => ({ t, lang, setLang }), [t, lang, setLang]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
};
