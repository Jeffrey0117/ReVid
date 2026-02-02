import { useState, useCallback } from 'react';
import { useTheme } from '../../theme.jsx';
import { useI18n } from '../../i18n.jsx';
import { getPlatformColor } from '../../utils/platformDetect';

/**
 * TheaterSidebar — folder/course list for the theater mode.
 * Follows the style of AlbumSidebar.
 *
 * Props:
 *   folders          - array of folder objects
 *   selectedFolderId - current folder id
 *   activeCourseId   - current active course id
 *   onSelectFolder   - callback(folderId)
 *   onCreateFolder   - callback(name)
 *   onRenameFolder   - callback(folderId, newName)
 *   onDeleteFolder   - callback(folderId)
 *   onOpenCourse     - callback(courseId)
 *   onRemoveCourse   - callback(folderId, courseId)
 *   onAddCourse      - callback() — triggers add dialog
 *   isVisible        - sidebar visibility
 */
export const TheaterSidebar = ({
  folders,
  selectedFolderId,
  activeCourseId,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onOpenCourse,
  onRemoveCourse,
  onAddCourse,
  isVisible = true
}) => {
  const { t } = useI18n();
  const { isDark } = useTheme();

  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const startRename = useCallback((folderId, currentName) => {
    setRenamingId(folderId);
    setRenameValue(currentName);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      onRenameFolder?.(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, onRenameFolder]);

  const selectedFolder = folders.find(f => f.id === selectedFolderId);
  const courses = selectedFolder?.courses?.filter(c => !c.deletedAt) || [];

  if (!isVisible) return null;

  return (
    <div className={`w-56 flex-shrink-0 flex flex-col h-full border-r overflow-hidden ${
      isDark ? 'bg-surface/30 border-white/5' : 'bg-white/50 border-black/10'
    }`}>
      {/* Folder header */}
      <div className={`px-3 py-2 flex items-center justify-between border-b ${
        isDark ? 'border-white/5' : 'border-black/10'
      }`}>
        <span className={`text-xs font-semibold uppercase tracking-wider ${
          isDark ? 'text-white/40' : 'text-gray-400'
        }`}>
          {t('courseFolder')}
        </span>
        <button
          onClick={() => onCreateFolder?.(`Folder ${folders.length + 1}`)}
          className="text-primary text-xs font-medium hover:text-primary/80 transition-colors"
        >
          +
        </button>
      </div>

      {/* Folder list */}
      <div className={`flex-shrink-0 max-h-32 overflow-y-auto border-b ${
        isDark ? 'border-white/5' : 'border-black/10'
      }`}>
        {folders.map(folder => {
          const isSelected = folder.id === selectedFolderId;
          const isRenaming = folder.id === renamingId;
          const courseCount = folder.courses?.filter(c => !c.deletedAt).length || 0;

          return (
            <div
              key={folder.id}
              onClick={() => !isRenaming && onSelectFolder?.(folder.id)}
              onDoubleClick={() => startRename(folder.id, folder.name)}
              onContextMenu={(e) => {
                e.preventDefault();
                // Could show context menu
              }}
              className={`px-3 py-1.5 cursor-pointer text-sm flex items-center gap-2 transition-colors ${
                isSelected
                  ? isDark ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary'
                  : isDark ? 'hover:bg-white/5 text-white/70' : 'hover:bg-black/5 text-gray-600'
              }`}
            >
              {isRenaming ? (
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  onBlur={commitRename}
                  autoFocus
                  className="flex-1 text-xs bg-transparent border border-primary/50 rounded px-1 outline-none"
                />
              ) : (
                <>
                  <span className="truncate flex-1 text-xs">{folder.name}</span>
                  <span className={`text-[10px] ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
                    {courseCount}
                  </span>
                </>
              )}
            </div>
          );
        })}

        {folders.length === 0 && (
          <div className={`px-3 py-4 text-center text-xs ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
            {t('selectOrCreateAlbum')}
          </div>
        )}
      </div>

      {/* Course list header */}
      {selectedFolder && (
        <div className={`px-3 py-2 flex items-center justify-between border-b ${
          isDark ? 'border-white/5' : 'border-black/10'
        }`}>
          <span className={`text-xs font-semibold ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
            {selectedFolder.name}
          </span>
          <button
            onClick={onAddCourse}
            className="text-primary text-xs font-medium hover:text-primary/80 transition-colors"
          >
            {t('addCourse')}
          </button>
        </div>
      )}

      {/* Course list */}
      <div className="flex-1 overflow-y-auto">
        {courses.map(course => {
          const isActive = course.id === activeCourseId;
          const platformColor = getPlatformColor(course.platform);
          const progress = course.progress?.duration > 0
            ? Math.round((course.progress.lastPosition / course.progress.duration) * 100)
            : 0;

          return (
            <div
              key={course.id}
              onClick={() => onOpenCourse?.(course.id)}
              className={`px-3 py-2 cursor-pointer transition-colors group ${
                isActive
                  ? isDark ? 'bg-primary/10' : 'bg-primary/10'
                  : isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'
              }`}
            >
              {/* Course title */}
              <div className="flex items-center gap-2">
                {/* Platform badge */}
                <span
                  className="w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center text-white flex-shrink-0"
                  style={{ backgroundColor: platformColor }}
                >
                  {course.platform?.[0]?.toUpperCase() || '?'}
                </span>
                <span className={`text-xs truncate flex-1 ${
                  isActive ? 'text-primary font-medium' : isDark ? 'text-white/70' : 'text-gray-600'
                }`}>
                  {course.title}
                </span>

                {/* Delete button (on hover) */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveCourse?.(selectedFolderId, course.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity p-0.5"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>

              {/* Progress bar */}
              {progress > 0 && (
                <div className="mt-1.5 h-0.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${Math.min(100, progress)}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}

        {selectedFolder && courses.length === 0 && (
          <div className={`px-3 py-8 text-center text-xs ${isDark ? 'text-white/30' : 'text-gray-400'}`}>
            {t('emptyAlbum')}
          </div>
        )}
      </div>
    </div>
  );
};
