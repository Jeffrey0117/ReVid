import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

const getElectronAPI = () => window.electronAPI || null;

const LAST_FOLDER_KEY = 'revid-last-folder';
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];

export const useVideoFileSystem = () => {
  const [files, setFiles] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [currentPath, setCurrentPath] = useState(null);

  const loadFolder = useCallback((folderPath) => {
    const electronAPI = getElectronAPI();
    if (!electronAPI) return;

    try {
      const videoFiles = electronAPI.getFilesInDirectory(folderPath, VIDEO_EXTENSIONS);

      if (videoFiles.length > 0) {
        setFiles(videoFiles);
        setCurrentIndex(0);
        setCurrentPath(folderPath);
        localStorage.setItem(LAST_FOLDER_KEY, folderPath);
      } else {
        setFiles([]);
        setCurrentIndex(-1);
        setCurrentPath(folderPath);
      }
    } catch (err) {
      setFiles([]);
      setCurrentIndex(-1);
    }
  }, []);

  // Open a single video file (e.g. from OS "Open with"): load its containing
  // folder so next/prev works, then select that exact file rather than the first.
  const openVideoFile = useCallback((filePath) => {
    const electronAPI = getElectronAPI();
    if (!electronAPI || !filePath) return;

    try {
      const folderPath = electronAPI.path.dirname(filePath);
      const videoFiles = electronAPI.getFilesInDirectory(folderPath, VIDEO_EXTENSIONS);

      if (videoFiles.length > 0) {
        // Match by basename — getFilesInDirectory rebuilds paths via path.join,
        // so separators/casing may differ from the raw argv path on Windows.
        const target = electronAPI.path.basename(filePath);
        const idx = videoFiles.findIndex(
          (f) => electronAPI.path.basename(f) === target
        );
        setFiles(videoFiles);
        setCurrentIndex(idx >= 0 ? idx : 0);
        setCurrentPath(folderPath);
        localStorage.setItem(LAST_FOLDER_KEY, folderPath);
      }
    } catch (err) {
      // ignore — leave current state untouched
    }
  }, []);

  const loadFolderRef = useRef(loadFolder);
  loadFolderRef.current = loadFolder;

  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 20;

    const tryLoad = () => {
      const electronAPI = getElectronAPI();
      if (electronAPI) {
        try {
          const lastFolder = localStorage.getItem(LAST_FOLDER_KEY);
          if (lastFolder) {
            const videoFiles = electronAPI.getFilesInDirectory(lastFolder, VIDEO_EXTENSIONS);
            if (videoFiles && videoFiles.length > 0) {
              loadFolderRef.current(lastFolder);
              return;
            }
          }
          const desktopPath = electronAPI.getDesktopPath();
          loadFolderRef.current(desktopPath);
        } catch (e) {
          try {
            const desktopPath = getElectronAPI().getDesktopPath();
            loadFolderRef.current(desktopPath);
          } catch (_) {
            // Desktop fallback also failed
          }
        }
      } else if (attempts < maxAttempts) {
        attempts++;
        setTimeout(tryLoad, 100);
      }
    };

    tryLoad();
  }, []);

  const nextVideo = useCallback(() => {
    if (files.length === 0) return;
    setCurrentIndex(prev => (prev + 1) % files.length);
  }, [files.length]);

  const prevVideo = useCallback(() => {
    if (files.length === 0) return;
    setCurrentIndex(prev => (prev - 1 + files.length) % files.length);
  }, [files.length]);

  const selectVideo = useCallback((index) => {
    if (index >= 0 && index < files.length) {
      setCurrentIndex(index);
    }
  }, [files.length]);

  const currentVideo = useMemo(
    () => files[currentIndex] || null,
    [files, currentIndex]
  );

  return {
    files,
    currentIndex,
    currentVideo,
    loadFolder,
    openVideoFile,
    selectVideo,
    nextVideo,
    prevVideo,
    currentPath
  };
};
