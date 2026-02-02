import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../theme.jsx';
import { useI18n } from '../../i18n.jsx';
import { detectPlatform, getPlatformColor } from '../../utils/platformDetect';

/**
 * AddCourseDialog — modal for adding a new course to a folder.
 *
 * Props:
 *   isOpen    - dialog visibility
 *   onClose   - close callback
 *   onAdd     - callback({ url, title, platform })
 */
export const AddCourseDialog = ({ isOpen, onClose, onAdd }) => {
  const { t } = useI18n();
  const { theme } = useTheme();

  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [platform, setPlatform] = useState(null);

  // Auto-detect platform from URL
  useEffect(() => {
    if (url.trim().startsWith('http')) {
      setPlatform(detectPlatform(url.trim()));
    } else {
      setPlatform(null);
    }
  }, [url]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    const detected = detectPlatform(trimmedUrl);
    onAdd?.({
      url: trimmedUrl,
      title: title.trim() || trimmedUrl,
      platform: detected.id
    });

    setUrl('');
    setTitle('');
    setPlatform(null);
    onClose?.();
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 400, maxWidth: '90vw',
          padding: 24, borderRadius: 12,
          background: theme.dialogBg,
          border: `1px solid ${theme.borderSecondary}`,
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 16
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: theme.text }}>
            {t('addCourseUrl')}
          </h3>
          <button
            className="btn btn-ghost"
            onClick={onClose}
            style={{ padding: '2px 6px', fontSize: 18, color: theme.textTertiary }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* URL input */}
          <div style={{ marginBottom: 12 }}>
            <label style={{
              display: 'block', fontSize: 12,
              color: theme.textTertiary, marginBottom: 6
            }}>
              {t('courseUrl')}
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.udemy.com/course/..."
              autoFocus
              style={{
                width: '100%', padding: '8px 12px',
                fontSize: 14, borderRadius: 6,
                background: theme.inputBg,
                border: `1px solid ${theme.border}`,
                color: theme.text,
                outline: 'none'
              }}
            />
          </div>

          {/* Platform indicator */}
          {platform && platform.id !== 'custom' && (
            <div style={{
              marginBottom: 12, display: 'flex',
              alignItems: 'center', gap: 8
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: 4,
                fontSize: 10, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff',
                backgroundColor: getPlatformColor(platform.id)
              }}>
                {platform.icon}
              </span>
              <span style={{ fontSize: 12, color: theme.textSecondary }}>
                {t('platformDetected', { platform: platform.name })}
              </span>
            </div>
          )}

          {/* Title input */}
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block', fontSize: 12,
              color: theme.textTertiary, marginBottom: 6
            }}>
              {t('courseTitle')}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={platform?.name ? `${platform.name} course...` : 'Course title...'}
              style={{
                width: '100%', padding: '8px 12px',
                fontSize: 14, borderRadius: 6,
                background: theme.inputBg,
                border: `1px solid ${theme.border}`,
                color: theme.text,
                outline: 'none'
              }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!url.trim()}
            >
              {t('openAndDetect')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
