import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { extractYouTubeVideoId } from '../utils/youtubeUrl';
import { validateRevidFile, revidToCourse } from '../utils/revidFile';

const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const getYouTubeThumbnail = (url) => {
  const videoId = extractYouTubeVideoId(url);
  return videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;
};

/**
 * Hook for managing virtual course theater with file-based persistence.
 *
 * Data Model:
 *   Folder { id, name, platform, courses[], createdAt }
 *   Course { id, url, title, thumbnail, platform,
 *            progress: { lastPosition, duration, lastWatched, completed },
 *            addedAt, deletedAt? }
 */
export const useWebTheater = () => {
  const [folders, setFolders] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [activeCourseId, setActiveCourseId] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const initialLoadDone = useRef(false);

  // Load from file on mount
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    const loadData = async () => {
      try {
        const api = window.electronAPI;
        if (api?.loadTheaterData) {
          const data = await api.loadTheaterData();
          if (data && Array.isArray(data)) {
            setFolders(data);
            if (data.length > 0) {
              setSelectedFolderId(data[0].id);
            }
          }
        }
      } catch (e) {
        console.error('[useWebTheater] Failed to load:', e);
      }
      setIsLoaded(true);
    };

    loadData();
  }, []);

  // Debounced save to file
  useEffect(() => {
    if (!isLoaded) return; // Don't save before initial load

    const timeoutId = setTimeout(() => {
      const api = window.electronAPI;
      if (api?.saveTheaterData) {
        api.saveTheaterData(folders).catch(e => {
          console.error('[useWebTheater] Failed to save:', e);
        });
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [folders, isLoaded]);

  // Selected folder (computed)
  const selectedFolder = useMemo(
    () => folders.find(f => f.id === selectedFolderId) || null,
    [folders, selectedFolderId]
  );

  // Active courses in selected folder (excluding soft-deleted)
  const activeCourses = useMemo(() => {
    if (!selectedFolder) return [];
    return selectedFolder.courses.filter(c => !c.deletedAt);
  }, [selectedFolder]);

  // Active course object
  const activeCourse = useMemo(() => {
    if (!activeCourseId || !selectedFolder) return null;
    return selectedFolder.courses.find(c => c.id === activeCourseId && !c.deletedAt) || null;
  }, [activeCourseId, selectedFolder]);

  // --- Folder CRUD ---

  const createFolder = useCallback((name, platform = 'custom') => {
    const newFolder = {
      id: generateId(),
      name: name || 'New Folder',
      platform,
      courses: [],
      createdAt: Date.now()
    };
    setFolders(prev => [...prev, newFolder]);
    setSelectedFolderId(newFolder.id);
    return newFolder;
  }, []);

  const renameFolder = useCallback((folderId, newName) => {
    setFolders(prev => prev.map(f =>
      f.id === folderId ? { ...f, name: newName } : f
    ));
  }, []);

  const deleteFolder = useCallback((folderId) => {
    setFolders(prev => prev.filter(f => f.id !== folderId));
    if (selectedFolderId === folderId) {
      setSelectedFolderId(prev => {
        const remaining = folders.filter(f => f.id !== folderId);
        return remaining.length > 0 ? remaining[0].id : null;
      });
    }
  }, [selectedFolderId, folders]);

  const selectFolder = useCallback((folderId) => {
    setSelectedFolderId(folderId);
    setActiveCourseId(null);
  }, []);

  // --- Course CRUD ---

  const updateCourseThumbnail = useCallback((folderId, courseId, thumbnail) => {
    setFolders(prev => prev.map(f => {
      if (f.id !== folderId) return f;
      return {
        ...f,
        courses: f.courses.map(c =>
          c.id === courseId ? { ...c, thumbnail } : c
        )
      };
    }));
  }, []);

  const addCourse = useCallback((folderId, { url, title, platform, thumbnail }) => {
    const autoThumbnail = platform === 'youtube'
      ? getYouTubeThumbnail(url)
      : null;

    const newCourse = {
      id: generateId(),
      url,
      title: title || url,
      thumbnail: thumbnail || autoThumbnail,
      platform: platform || 'custom',
      progress: {
        lastPosition: 0,
        duration: 0,
        lastWatched: null,
        completed: false
      },
      addedAt: Date.now(),
      deletedAt: null
    };

    setFolders(prev => prev.map(f => {
      if (f.id !== folderId) return f;
      return { ...f, courses: [...f.courses, newCourse] };
    }));

    return newCourse;
  }, []);

  const removeCourse = useCallback((folderId, courseId) => {
    setFolders(prev => prev.map(f => {
      if (f.id !== folderId) return f;
      return {
        ...f,
        courses: f.courses.map(c =>
          c.id === courseId ? { ...c, deletedAt: Date.now() } : c
        )
      };
    }));

    if (activeCourseId === courseId) {
      setActiveCourseId(null);
    }
  }, [activeCourseId]);

  const renameCourse = useCallback((folderId, courseId, newTitle) => {
    setFolders(prev => prev.map(f => {
      if (f.id !== folderId) return f;
      return {
        ...f,
        courses: f.courses.map(c =>
          c.id === courseId ? { ...c, title: newTitle } : c
        )
      };
    }));
  }, []);

  // Update course URL and click path (when user navigates to video page)
  const updateCourseUrl = useCallback((folderId, courseId, newUrl, clickPath = null) => {
    setFolders(prev => prev.map(f => {
      if (f.id !== folderId) return f;
      return {
        ...f,
        courses: f.courses.map(c => {
          if (c.id !== courseId) return c;
          const updated = { ...c, url: newUrl };
          if (clickPath !== null) {
            updated.clickPath = clickPath;
          }
          return updated;
        })
      };
    }));
  }, []);

  const updateProgress = useCallback((folderId, courseId, progress) => {
    setFolders(prev => prev.map(f => {
      if (f.id !== folderId) return f;
      return {
        ...f,
        courses: f.courses.map(c => {
          if (c.id !== courseId) return c;
          return {
            ...c,
            progress: { ...c.progress, ...progress, lastWatched: Date.now() }
          };
        })
      };
    }));
  }, []);

  const openCourse = useCallback((courseId) => {
    setActiveCourseId(courseId);
  }, []);

  const closeCourse = useCallback(() => {
    setActiveCourseId(null);
  }, []);

  // --- Import ---

  const importRevidFile = useCallback((revidData, targetFolderId) => {
    const validation = validateRevidFile(revidData);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const fId = targetFolderId || selectedFolderId;
    if (!fId) {
      return { success: false, error: 'No folder selected' };
    }

    const course = revidToCourse(revidData);
    setFolders(prev => prev.map(f => {
      if (f.id !== fId) return f;
      return { ...f, courses: [...f.courses, course] };
    }));

    return { success: true, course };
  }, [selectedFolderId]);

  const importRevidFiles = useCallback((revidDataArray, targetFolderId) => {
    const fId = targetFolderId || selectedFolderId;
    if (!fId) {
      return { success: false, error: 'No folder selected' };
    }

    const courses = [];
    for (const revidData of revidDataArray) {
      const validation = validateRevidFile(revidData);
      if (validation.valid) {
        courses.push(revidToCourse(revidData));
      }
    }

    if (courses.length === 0) {
      return { success: false, error: 'No valid .revid data' };
    }

    setFolders(prev => prev.map(f => {
      if (f.id !== fId) return f;
      return { ...f, courses: [...f.courses, ...courses] };
    }));

    return { success: true, count: courses.length };
  }, [selectedFolderId]);

  const importJsonBackup = useCallback((collectionData, mode = 'merge') => {
    const validation = validateRevidFile(collectionData);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    if (collectionData.type !== 'revid-collection') {
      return { success: false, error: 'Not a collection file' };
    }

    const importedFolders = (collectionData.folders || []).map(folder => {
      const folderId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      return {
        id: folderId,
        name: folder.name || 'Imported Folder',
        platform: folder.platform || 'custom',
        courses: (folder.courses || []).map(c => revidToCourse(c)),
        createdAt: Date.now(),
      };
    });

    if (mode === 'replace') {
      setFolders(importedFolders);
      if (importedFolders.length > 0) {
        setSelectedFolderId(importedFolders[0].id);
      }
    } else {
      setFolders(prev => [...prev, ...importedFolders]);
    }

    return { success: true, count: importedFolders.length };
  }, []);

  return useMemo(() => ({
    folders,
    selectedFolder,
    selectedFolderId,
    activeCourses,
    activeCourse,
    activeCourseId,
    selectFolder,
    createFolder,
    renameFolder,
    deleteFolder,
    addCourse,
    removeCourse,
    renameCourse,
    updateCourseUrl,
    updateProgress,
    updateCourseThumbnail,
    openCourse,
    closeCourse,
    importRevidFile,
    importRevidFiles,
    importJsonBackup,
  }), [
    folders, selectedFolder, selectedFolderId,
    activeCourses, activeCourse, activeCourseId,
    selectFolder, createFolder, renameFolder, deleteFolder,
    addCourse, removeCourse, renameCourse, updateCourseUrl, updateProgress,
    updateCourseThumbnail, openCourse, closeCourse,
    importRevidFile, importRevidFiles, importJsonBackup,
  ]);
};
