import { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../theme.jsx';
import { useI18n } from '../../i18n.jsx';
import { createRevidFile, generateRevidFileName } from '../../utils/revidFile';
import { loadUploadConfig } from './UploadSettings.jsx';

const getElectronAPI = () => window.electronAPI || null;

/**
 * UploadDialog — upload local video files via user-configured API.
 * Shows per-file progress, options for .revid save and theater add.
 */
export const UploadDialog = ({ isOpen, onClose, selectedFolderId, onAddCourse }) => {
  const { t } = useI18n();
  const { theme, isDark } = useTheme();

  const [files, setFiles] = useState([]);
  const [saveRevid, setSaveRevid] = useState(true);
  const [addToTheater, setAddToTheater] = useState(true);
  const uploadingRef = useRef(false);

  const handleSelectFiles = useCallback(async () => {
    const api = getElectronAPI();
    if (!api) return;
    const result = await api.selectVideoForUpload();
    if (result?.success && result.filePaths) {
      setFiles(result.filePaths.map(fp => ({
        path: fp,
        name: fp.split(/[\\/]/).pop(),
        status: 'pending',
        progress: 0,
        error: null,
        result: null,
      })));
    }
  }, []);

  const handleUpload = useCallback(async () => {
    const api = getElectronAPI();
    if (!api) return;

    const config = loadUploadConfig();
    if (!config?.apiUrl) return;

    uploadingRef.current = true;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.status === 'done') continue;

      setFiles(prev => prev.map((f, idx) =>
        idx === i ? { ...f, status: 'uploading', progress: 0, error: null } : f
      ));

      try {
        const result = await api.uploadVideoFile(file.path, config, (pct) => {
          setFiles(prev => prev.map((f, idx) =>
            idx === i ? { ...f, progress: pct } : f
          ));
        });

        if (result?.success && result.data?.url) {
          setFiles(prev => prev.map((f, idx) =>
            idx === i ? { ...f, status: 'done', progress: 100, result: result.data } : f
          ));

          // Save .revid next to original file
          if (saveRevid) {
            const revidData = createRevidFile({
              url: result.data.url,
              title: file.name.replace(/\.[^.]+$/, ''),
              platform: 'uploaded',
              thumbnail: result.data.thumbnailUrl || null,
              progress: {
                lastPosition: 0,
                duration: result.data.duration || 0,
                lastWatched: null,
                completed: false,
              },
              source: {
                originalFileName: file.name,
                originalSize: result.data.size || 0,
                uploadedAt: Date.now(),
              },
            });

            const revidPath = file.path.replace(/\.[^.]+$/, '.revid');
            await api.writeRevidFile(revidPath, revidData);
          }

          // Add to theater folder
          if (addToTheater && selectedFolderId && onAddCourse) {
            onAddCourse({
              url: result.data.url,
              title: file.name.replace(/\.[^.]+$/, ''),
              platform: 'uploaded',
            });
          }
        } else {
          setFiles(prev => prev.map((f, idx) =>
            idx === i ? { ...f, status: 'error', error: result?.error || t('uploadFailed') } : f
          ));
        }
      } catch (e) {
        setFiles(prev => prev.map((f, idx) =>
          idx === i ? { ...f, status: 'error', error: e.message } : f
        ));
      }
    }

    uploadingRef.current = false;
  }, [files, saveRevid, addToTheater, selectedFolderId, onAddCourse, t]);

  const handleRetry = useCallback((index) => {
    setFiles(prev => prev.map((f, idx) =>
      idx === index ? { ...f, status: 'pending', progress: 0, error: null } : f
    ));
  }, []);

  const handleClose = () => {
    if (!uploadingRef.current) {
      setFiles([]);
      onClose?.();
    }
  };

  if (!isOpen) return null;

  const hasFiles = files.length > 0;
  const hasPending = files.some(f => f.status === 'pending' || f.status === 'error');
  const isUploading = files.some(f => f.status === 'uploading');
  const config = loadUploadConfig();
  const hasConfig = !!config?.apiUrl;

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
      }}
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480, maxWidth: '90vw', maxHeight: '80vh',
          padding: 20, borderRadius: 16,
          background: isDark ? '#1a1a1a' : '#fff',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 16,
        }}>
          <h3 style={{
            fontSize: 18, fontWeight: 600,
            color: isDark ? '#fff' : '#1f2937',
          }}>
            {t('uploadVideo')}
          </h3>
          <button
            onClick={handleClose}
            style={{
              padding: 6, borderRadius: 8,
              color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.4)',
              transition: 'background 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* No config warning */}
        {!hasConfig && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 12,
            background: isDark ? 'rgba(251,191,36,0.1)' : 'rgba(217,119,6,0.1)',
            color: isDark ? '#fbbf24' : '#d97706',
            fontSize: 13,
          }}>
            {t('uploadSettings')} - {t('uploadApiUrl')}
          </div>
        )}

        {/* File list */}
        {hasFiles ? (
          <div style={{
            flex: 1, overflowY: 'auto',
            marginBottom: 12,
          }}>
            {files.map((file, index) => (
              <div key={file.path} style={{
                padding: '10px 12px', marginBottom: 4,
                borderRadius: 8,
                background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 500,
                    color: isDark ? '#fff' : '#1f2937',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    flex: 1, minWidth: 0,
                  }}>
                    {file.name}
                  </span>
                  {file.status === 'done' && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  {file.status === 'error' && (
                    <button
                      onClick={() => handleRetry(index)}
                      style={{
                        fontSize: 12, color: theme.accent,
                        padding: '2px 8px', borderRadius: 4,
                        background: isDark ? 'rgba(59,130,246,0.15)' : 'rgba(91,142,201,0.1)',
                        border: 'none', cursor: 'pointer',
                      }}
                    >
                      {t('uploadRetry')}
                    </button>
                  )}
                </div>

                {/* Progress bar */}
                {(file.status === 'uploading' || file.status === 'done') && (
                  <div style={{
                    height: 3, borderRadius: 999,
                    background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%', borderRadius: 999,
                      background: file.status === 'done' ? '#22c55e' : theme.accent,
                      transition: 'width 0.3s',
                      width: `${file.progress}%`,
                    }} />
                  </div>
                )}

                {/* Error message */}
                {file.error && (
                  <div style={{
                    marginTop: 4, fontSize: 12,
                    color: isDark ? '#f87171' : '#dc2626',
                  }}>
                    {file.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          /* Select files button */
          <button
            onClick={handleSelectFiles}
            style={{
              width: '100%', padding: '24px 16px',
              borderRadius: 10, marginBottom: 12,
              border: `2px dashed ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)'}`,
              background: 'transparent', cursor: 'pointer',
              color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)',
              fontSize: 14, textAlign: 'center',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = isDark ? 'rgba(59,130,246,0.5)' : 'rgba(91,142,201,0.5)';
              e.currentTarget.style.color = theme.accent;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)';
              e.currentTarget.style.color = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 8px' }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <div>{t('uploadSelectFiles')}</div>
          </button>
        )}

        {/* Options */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 6,
            cursor: 'pointer', fontSize: 13,
            color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)',
          }}>
            <input
              type="checkbox"
              checked={saveRevid}
              onChange={(e) => setSaveRevid(e.target.checked)}
              style={{ accentColor: theme.accent }}
            />
            {t('uploadSaveRevid')}
          </label>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 6,
            cursor: 'pointer', fontSize: 13,
            color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)',
          }}>
            <input
              type="checkbox"
              checked={addToTheater}
              onChange={(e) => setAddToTheater(e.target.checked)}
              style={{ accentColor: theme.accent }}
            />
            {t('uploadAddToTheater')}
          </label>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {hasFiles && (
            <button
              onClick={handleSelectFiles}
              style={{
                padding: '8px 16px', fontSize: 14, fontWeight: 500,
                borderRadius: 8, transition: 'background 0.15s',
                background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
                border: 'none', cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}
            >
              {t('uploadSelectFiles')}
            </button>
          )}
          <button
            onClick={handleUpload}
            disabled={!hasFiles || !hasPending || isUploading || !hasConfig}
            style={{
              padding: '8px 16px', fontSize: 14, fontWeight: 500,
              borderRadius: 8, transition: 'background 0.15s',
              background: theme.accent, color: '#fff',
              border: 'none', cursor: 'pointer',
              opacity: (!hasFiles || !hasPending || isUploading || !hasConfig) ? 0.5 : 1,
            }}
            onMouseEnter={e => { if (hasFiles && hasPending && !isUploading && hasConfig) e.currentTarget.style.opacity = '0.8'; }}
            onMouseLeave={e => { if (hasFiles && hasPending && !isUploading && hasConfig) e.currentTarget.style.opacity = '1'; }}
          >
            {isUploading ? t('uploading') : t('uploadVideo')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
