import { useState, useCallback } from 'react';
import { useTheme } from '../../theme.jsx';
import { useI18n } from '../../i18n.jsx';
import { getPlatformColor, getPlatformIcon } from '../../utils/platformDetect';

/**
 * TheaterSidebar — folder/course list for the theater mode.
 * Uses inline styles + theme tokens to match app-wide style.
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
  const { theme } = useTheme();

  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [hoveredFolderId, setHoveredFolderId] = useState(null);
  const [hoveredCourseId, setHoveredCourseId] = useState(null);

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
    <div style={{
      width: 224, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      height: '100%', overflow: 'hidden',
      background: theme.bgTertiary,
      borderRight: `1px solid ${theme.border}`
    }}>
      {/* Folder header */}
      <div style={{
        padding: '8px 12px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${theme.border}`
      }}>
        <span style={{
          fontSize: 11, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.05em',
          color: theme.textTertiary
        }}>
          {t('courseFolder')}
        </span>
        <button
          onClick={() => onCreateFolder?.(`Folder ${folders.length + 1}`)}
          className="btn btn-ghost"
          style={{
            color: theme.accent, fontSize: 16, fontWeight: 600,
            padding: '2px 8px', borderRadius: 6, lineHeight: 1
          }}
        >
          +
        </button>
      </div>

      {/* Folder list */}
      <div style={{
        flexShrink: 0, maxHeight: 128,
        overflowY: 'auto',
        borderBottom: `1px solid ${theme.border}`
      }}>
        {folders.map(folder => {
          const isSelected = folder.id === selectedFolderId;
          const isRenaming = folder.id === renamingId;
          const isHovered = folder.id === hoveredFolderId;
          const courseCount = folder.courses?.filter(c => !c.deletedAt).length || 0;

          return (
            <div
              key={folder.id}
              onClick={() => !isRenaming && onSelectFolder?.(folder.id)}
              onDoubleClick={() => startRename(folder.id, folder.name)}
              onMouseEnter={() => setHoveredFolderId(folder.id)}
              onMouseLeave={() => setHoveredFolderId(null)}
              style={{
                padding: '6px 12px',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                transition: 'background 0.15s',
                background: isSelected ? theme.accentBg : isHovered ? theme.hoverBg : 'transparent',
                color: isSelected ? theme.accent : theme.textSecondary
              }}
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
                  style={{
                    flex: 1, fontSize: 12,
                    background: 'transparent',
                    border: `1px solid ${theme.accent}`,
                    borderRadius: 4, padding: '2px 4px',
                    color: theme.text, outline: 'none'
                  }}
                />
              ) : (
                <>
                  <span style={{
                    flex: 1, fontSize: 12,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}>
                    {folder.name}
                  </span>
                  <span style={{ fontSize: 10, color: theme.textTertiary }}>
                    {courseCount}
                  </span>
                </>
              )}
            </div>
          );
        })}

        {folders.length === 0 && (
          <div style={{
            padding: '16px 12px', textAlign: 'center',
            fontSize: 12, color: theme.textTertiary
          }}>
            {t('selectOrCreateAlbum')}
          </div>
        )}
      </div>

      {/* Course list header */}
      {selectedFolder && (
        <div style={{
          padding: '8px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: `1px solid ${theme.border}`
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: theme.textSecondary }}>
            {selectedFolder.name}
          </span>
          <button
            onClick={onAddCourse}
            className="btn btn-ghost"
            style={{
              color: theme.accent, fontSize: 12, fontWeight: 500,
              padding: '3px 8px', borderRadius: 6
            }}
          >
            {t('addCourse')}
          </button>
        </div>
      )}

      {/* Course list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {courses.map(course => {
          const isActive = course.id === activeCourseId;
          const isHovered = course.id === hoveredCourseId;
          const platformColor = getPlatformColor(course.platform);
          const progress = course.progress?.duration > 0
            ? Math.round((course.progress.lastPosition / course.progress.duration) * 100)
            : 0;

          return (
            <div
              key={course.id}
              onClick={() => onOpenCourse?.(course.id)}
              onMouseEnter={() => setHoveredCourseId(course.id)}
              onMouseLeave={() => setHoveredCourseId(null)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                transition: 'background 0.15s',
                background: isActive ? theme.accentBg : isHovered ? theme.hoverBg : 'transparent'
              }}
            >
              {/* Course title row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Platform badge */}
                <span style={{
                  width: 16, height: 16, borderRadius: 3,
                  fontSize: 9, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', flexShrink: 0,
                  backgroundColor: platformColor
                }}>
                  {getPlatformIcon(course.platform) || '?'}
                </span>
                <span style={{
                  fontSize: 12, flex: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: isActive ? theme.accent : theme.textSecondary,
                  fontWeight: isActive ? 500 : 400
                }}>
                  {course.title}
                </span>

                {/* Delete button (on hover) */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveCourse?.(selectedFolderId, course.id);
                  }}
                  style={{
                    opacity: isHovered ? 1 : 0,
                    color: theme.error,
                    transition: 'opacity 0.15s',
                    padding: 2
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>

              {/* Progress bar */}
              {progress > 0 && (
                <div style={{
                  marginTop: 6, height: 2,
                  background: theme.border,
                  borderRadius: 999, overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    background: theme.accent,
                    borderRadius: 999,
                    transition: 'width 0.3s',
                    width: `${Math.min(100, progress)}%`
                  }} />
                </div>
              )}
            </div>
          );
        })}

        {selectedFolder && courses.length === 0 && (
          <div style={{
            padding: '32px 12px', textAlign: 'center',
            fontSize: 12, color: theme.textTertiary
          }}>
            {t('emptyAlbum')}
          </div>
        )}
      </div>
    </div>
  );
};
