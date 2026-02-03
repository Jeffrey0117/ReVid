const REVID_VERSION = 1;

/**
 * Generate a filesystem-safe filename from a title.
 */
export const generateRevidFileName = (title) => {
  if (!title) return 'untitled.revid';
  const safe = title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 100);
  return `${safe || 'untitled'}.revid`;
};

/**
 * Convert a course object to .revid JSON format.
 * @param {object} course - course from useWebTheater
 * @param {object} options - { includeProgress: boolean }
 */
export const createRevidFile = (course, options = {}) => {
  const { includeProgress = true } = options;

  const revid = {
    v: REVID_VERSION,
    type: 'virtual-video',
    url: course.url,
    title: course.title || course.url,
    platform: course.platform || 'custom',
    thumbnail: course.thumbnail || null,
  };

  if (includeProgress && course.progress) {
    revid.progress = {
      lastPosition: course.progress.lastPosition || 0,
      duration: course.progress.duration || 0,
      lastWatched: course.progress.lastWatched || null,
      completed: course.progress.completed || false,
    };
  }

  if (course.source) {
    revid.source = { ...course.source };
  }

  return revid;
};

/**
 * Create a collection export object from folders.
 * @param {Array} folders - array of folder objects
 * @param {object} options - { includeProgress: boolean }
 */
export const createRevidCollection = (folders, options = {}) => {
  const { includeProgress = true } = options;

  return {
    v: REVID_VERSION,
    type: 'revid-collection',
    exportedAt: Date.now(),
    folders: folders.map(folder => ({
      id: folder.id,
      name: folder.name,
      platform: folder.platform,
      courses: (folder.courses || [])
        .filter(c => !c.deletedAt)
        .map(c => createRevidFile(c, { includeProgress })),
    })),
  };
};

/**
 * Validate a parsed .revid JSON object.
 * Returns { valid: boolean, error?: string }
 */
export const validateRevidFile = (data) => {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid data: not an object' };
  }

  if (data.type === 'revid-collection') {
    if (!Array.isArray(data.folders)) {
      return { valid: false, error: 'Collection missing folders array' };
    }
    return { valid: true };
  }

  if (data.type !== 'virtual-video') {
    return { valid: false, error: `Unknown type: ${data.type}` };
  }

  if (!data.url || typeof data.url !== 'string') {
    return { valid: false, error: 'Missing or invalid url' };
  }

  return { valid: true };
};

/**
 * Convert a .revid object back to a course object for useWebTheater.
 */
export const revidToCourse = (revidData) => {
  const now = Date.now();
  const id = `${now}-${Math.random().toString(36).substr(2, 9)}`;

  return {
    id,
    url: revidData.url,
    title: revidData.title || revidData.url,
    thumbnail: revidData.thumbnail || null,
    platform: revidData.platform || 'custom',
    progress: revidData.progress
      ? {
          lastPosition: revidData.progress.lastPosition || 0,
          duration: revidData.progress.duration || 0,
          lastWatched: revidData.progress.lastWatched || null,
          completed: revidData.progress.completed || false,
        }
      : {
          lastPosition: 0,
          duration: 0,
          lastWatched: null,
          completed: false,
        },
    addedAt: now,
    deletedAt: null,
  };
};
