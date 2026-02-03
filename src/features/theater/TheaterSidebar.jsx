import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../theme.jsx';
import { useI18n } from '../../i18n.jsx';

/**
 * TheaterSidebar — folder list for online video mode.
 * Courses are shown in the main viewport as a grid.
 */
export const TheaterSidebar = ({
  folders,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onExport,
  onImport,
  isVisible = true
}) => {
  const { t } = useI18n();
  const { theme, isDark } = useTheme();

  const [isCreating, setIsCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [hoveredFolderId, setHoveredFolderId] = useState(null);

  // Rename dialog state (modal, REPIC-style)
  const [renameDialog, setRenameDialog] = useState({ open: false, folderId: null, albumName: '' });
  const renameInputRef = useRef(null);

  useEffect(() => {
    if (renameDialog.open && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renameDialog.open]);

  const openRenameDialog = useCallback((folderId, currentName) => {
    setRenameDialog({ open: true, folderId, albumName: currentName });
  }, []);

  const closeRenameDialog = useCallback(() => {
    setRenameDialog({ open: false, folderId: null, albumName: '' });
  }, []);

  const handleRename = useCallback(() => {
    if (renameDialog.folderId && renameDialog.albumName.trim()) {
      onRenameFolder?.(renameDialog.folderId, renameDialog.albumName.trim());
    }
    closeRenameDialog();
  }, [renameDialog, onRenameFolder, closeRenameDialog]);

  const handleCreateFolder = useCallback(() => {
    if (newFolderName.trim()) {
      onCreateFolder?.(newFolderName.trim());
    }
    setIsCreating(false);
    setNewFolderName('');
  }, [newFolderName, onCreateFolder]);

  const handleKeyDown = useCallback((e, action) => {
    if (e.key === 'Enter') action();
    if (e.key === 'Escape') {
      setIsCreating(false);
      setNewFolderName('');
      closeRenameDialog();
    }
  }, [closeRenameDialog]);


  if (!isVisible) return null;

  return (
    <div style={{
      width: 240, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      height: '100%', overflow: 'hidden',
      background: isDark ? 'rgba(28,28,30,0.5)' : '#f9fafb',
      borderRight: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'}`
    }}>
      {/* ── Folder header ── */}
      <div style={{
        padding: '12px 12px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'}`
      }}>
        <span style={{
          fontSize: 13, fontWeight: 600,
          color: isDark ? '#fff' : '#1f2937'
        }}>
          {t('courseFolder')}
        </span>
        <div style={{ display: 'flex', gap: 2 }}>
          {/* Export button */}
          <button
            onClick={onExport}
            title={t('exportData')}
            style={{
              padding: 4, borderRadius: 6,
              color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
              transition: 'color 0.15s, background 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = theme.accent; e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'; e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          {/* Import button */}
          <button
            onClick={onImport}
            title={t('importData')}
            style={{
              padding: 4, borderRadius: 6,
              color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
              transition: 'color 0.15s, background 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = theme.accent; e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'; e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Folder list ── */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 8
      }}>
        {folders.map(folder => {
          const isSelected = folder.id === selectedFolderId;
          const isHovered = folder.id === hoveredFolderId;
          const courseCount = folder.courses?.filter(c => !c.deletedAt).length || 0;

          return (
            <div
              key={folder.id}
              onClick={() => onSelectFolder?.(folder.id)}
              onDoubleClick={() => openRenameDialog(folder.id, folder.name)}
              onMouseEnter={() => setHoveredFolderId(folder.id)}
              onMouseLeave={() => setHoveredFolderId(null)}
              style={{
                padding: '10px 12px', marginBottom: 2,
                cursor: 'pointer', borderRadius: 8,
                display: 'flex', alignItems: 'center', gap: 10,
                transition: 'all 0.15s',
                background: isSelected
                  ? (isDark ? 'rgba(59,130,246,0.2)' : 'rgba(91,142,201,0.15)')
                  : isHovered
                    ? (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)')
                    : 'transparent',
                border: `1px solid ${isSelected
                  ? (isDark ? 'rgba(59,130,246,0.3)' : 'rgba(91,142,201,0.3)')
                  : 'transparent'
                }`
              }}
            >
              {/* Folder icon */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke={isSelected ? theme.accent : (isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)')}
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
              </svg>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: isSelected ? 600 : 400,
                  color: isSelected ? theme.accent : (isDark ? '#fff' : '#1f2937'),
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}>
                  {folder.name}
                </div>
                <div style={{
                  fontSize: 11, marginTop: 1,
                  color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)'
                }}>
                  {courseCount} {t('videos')}
                </div>
              </div>

              {/* Delete on hover */}
              {isHovered && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteFolder?.(folder.id); }}
                  style={{
                    padding: 2, flexShrink: 0,
                    color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
                    transition: 'color 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = theme.error}
                  onMouseLeave={e => e.currentTarget.style.color = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}

        {/* + New Folder — dashed button or inline create input */}
        {isCreating ? (
          <div style={{
            padding: 12, borderRadius: 8, marginTop: 4,
            background: isDark ? 'rgba(255,255,255,0.05)' : '#f3f4f6'
          }}>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, handleCreateFolder)}
              placeholder={t('courseFolder')}
              autoFocus
              style={{
                width: '100%', padding: '6px 8px', fontSize: 13,
                borderRadius: 4,
                background: isDark ? 'rgba(0,0,0,0.3)' : '#fff',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)'}`,
                color: isDark ? '#fff' : '#1f2937',
                outline: 'none'
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                style={{
                  flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 500,
                  borderRadius: 4, border: 'none', cursor: 'pointer',
                  background: theme.accent, color: '#fff',
                  opacity: !newFolderName.trim() ? 0.5 : 1
                }}
              >
                {t('confirm')}
              </button>
              <button
                onClick={() => { setIsCreating(false); setNewFolderName(''); }}
                style={{
                  flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 500,
                  borderRadius: 4, border: 'none', cursor: 'pointer',
                  background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
                  color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)'
                }}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            style={{
              width: '100%', padding: 12, marginTop: 4,
              borderRadius: 8, fontSize: 13, fontWeight: 500,
              border: `2px dashed ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)'}`,
              background: 'transparent', cursor: 'pointer',
              color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
              transition: 'all 0.15s'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = isDark ? 'rgba(59,130,246,0.5)' : 'rgba(91,142,201,0.5)';
              e.currentTarget.style.color = theme.accent;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)';
              e.currentTarget.style.color = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
            }}
          >
            + {t('newFolder')}
          </button>
        )}

        {folders.length === 0 && !isCreating && (
          <div style={{
            padding: '16px 8px', textAlign: 'center',
            fontSize: 13,
            color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'
          }}>
            {t('selectOrCreateAlbum')}
          </div>
        )}
      </div>

      {/* ── Rename Dialog (REPIC modal pattern) ── */}
      {createPortal(
        renameDialog.open ? (
          <div
            style={{
              position: 'fixed', inset: 0, zIndex: 200,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)'
            }}
            onClick={closeRenameDialog}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 320, padding: 16, borderRadius: 12,
                background: isDark ? '#1a1a1a' : '#fff',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
              }}
            >
              <h3 style={{
                fontSize: 16, fontWeight: 600, marginBottom: 12,
                color: isDark ? '#fff' : '#1f2937'
              }}>
                {t('rename')}
              </h3>
              <input
                ref={renameInputRef}
                type="text"
                value={renameDialog.albumName}
                onChange={(e) => setRenameDialog(prev => ({ ...prev, albumName: e.target.value }))}
                onKeyDown={(e) => handleKeyDown(e, handleRename)}
                style={{
                  width: '100%', padding: '8px 12px', fontSize: 14,
                  borderRadius: 8,
                  background: isDark ? 'rgba(255,255,255,0.05)' : '#f9fafb',
                  border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)'}`,
                  color: isDark ? '#fff' : '#1f2937',
                  outline: 'none', transition: 'border-color 0.15s'
                }}
                onFocus={e => e.currentTarget.style.borderColor = isDark ? 'rgba(59,130,246,0.5)' : 'rgba(91,142,201,0.5)'}
                onBlur={e => e.currentTarget.style.borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)'}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button
                  onClick={closeRenameDialog}
                  style={{
                    flex: 1, padding: '8px 0', fontSize: 14, fontWeight: 500,
                    borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                    color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
                    transition: 'background 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
                  onMouseLeave={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={handleRename}
                  disabled={!renameDialog.albumName.trim()}
                  style={{
                    flex: 1, padding: '8px 0', fontSize: 14, fontWeight: 500,
                    borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: theme.accent, color: '#fff',
                    transition: 'background 0.15s',
                    opacity: !renameDialog.albumName.trim() ? 0.5 : 1
                  }}
                  onMouseEnter={e => { if (renameDialog.albumName.trim()) e.currentTarget.style.opacity = '0.8'; }}
                  onMouseLeave={e => { if (renameDialog.albumName.trim()) e.currentTarget.style.opacity = '1'; }}
                >
                  {t('confirm')}
                </button>
              </div>
            </div>
          </div>
        ) : null,
        document.body
      )}
    </div>
  );
};
