import { useState, useEffect, useCallback, useMemo } from 'react';

const STORAGE_KEY = 'revid-web-theater';

const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const loadFromStorage = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch (e) {
    return [];
  }
};

let _initialFolders = null;
const getInitialFolders = () => {
  if (_initialFolders === null) {
    _initialFolders = loadFromStorage();
  }
  return _initialFolders;
};

/**
 * Hook for managing virtual course theater with localStorage persistence.
 *
 * Data Model:
 *   Folder { id, name, platform, courses[], createdAt }
 *   Course { id, url, title, thumbnail, platform,
 *            progress: { lastPosition, duration, lastWatched, completed },
 *            addedAt, deletedAt? }
 */
export const useWebTheater = () => {
  const [folders, setFolders] = useState(getInitialFolders);
  const [selectedFolderId, setSelectedFolderId] = useState(() => {
    const initial = getInitialFolders();
    return initial.length > 0 ? initial[0].id : null;
  });
  const [activeCourseId, setActiveCourseId] = useState(null);

  // Debounced save to localStorage
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(folders));
      } catch (e) {
        // Storage error
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [folders]);

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

  const addCourse = useCallback((folderId, { url, title, platform, thumbnail }) => {
    const newCourse = {
      id: generateId(),
      url,
      title: title || url,
      thumbnail: thumbnail || null,
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
    updateProgress,
    openCourse,
    closeCourse
  }), [
    folders, selectedFolder, selectedFolderId,
    activeCourses, activeCourse, activeCourseId,
    selectFolder, createFolder, renameFolder, deleteFolder,
    addCourse, removeCourse, renameCourse, updateProgress,
    openCourse, closeCourse
  ]);
};
