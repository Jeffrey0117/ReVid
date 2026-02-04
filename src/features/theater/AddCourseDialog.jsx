import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../theme.jsx';
import { useI18n } from '../../i18n.jsx';
import { detectPlatform, getPlatformColor } from '../../utils/platformDetect';

/**
 * AddCourseDialog — modal for adding video URLs to a folder.
 * Matches REPIC's "Add Image URL" dialog pattern:
 * - Textarea for pasting multiple URLs
 * - Auto-detect + add on paste
 * - Rounded-2xl modal with backdrop blur
 *
 * Props:
 *   isOpen    - dialog visibility
 *   onClose   - close callback
 *   onAdd     - callback({ url, title, platform })  called per-URL
 */
export const AddCourseDialog = ({ isOpen, onClose, onAdd }) => {
  const { t } = useI18n();
  const { theme, isDark } = useTheme();

  const [urlInput, setUrlInput] = useState('');
  const [title, setTitle] = useState('');
  const [platform, setPlatform] = useState(null);

  // Auto-detect platform from first URL line
  useEffect(() => {
    const firstLine = urlInput.split(/[\n,]/)[0]?.trim() || '';
    if (firstLine.startsWith('http')) {
      setPlatform(detectPlatform(firstLine));
    } else {
      setPlatform(null);
    }
  }, [urlInput]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const urls = urlInput.split(/[\n,]/).map(u => u.trim()).filter(Boolean);
    if (urls.length === 0) return;

    for (const url of urls) {
      const detected = detectPlatform(url);
      onAdd?.({
        url,
        title: urls.length === 1 ? (title.trim() || url) : url,
        platform: detected.id
      });
    }

    setUrlInput('');
    setTitle('');
    setPlatform(null);
    onClose?.();
  };

  // No auto-add on paste - let user edit and click 新增

  if (!isOpen) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420, maxWidth: '90vw',
          padding: 20, borderRadius: 16,
          background: isDark ? '#1a1a1a' : '#fff',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 16
        }}>
          <h3 style={{
            fontSize: 18, fontWeight: 600,
            color: isDark ? '#fff' : '#1f2937'
          }}>
            {t('addCourseUrl')}
          </h3>
          <button
            onClick={onClose}
            style={{
              padding: 6, borderRadius: 8,
              color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.4)',
              transition: 'background 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
            onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* URL textarea */}
          <textarea
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder={t('pasteVideoUrlPlaceholder')}
            rows={4}
            autoFocus
            style={{
              width: '100%', padding: '10px 12px',
              fontSize: 14, borderRadius: 12, resize: 'none',
              background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
              color: isDark ? '#fff' : '#1f2937',
              outline: 'none',
              transition: 'border-color 0.15s',
              fontFamily: 'inherit'
            }}
            onFocus={e => e.currentTarget.style.borderColor = isDark ? 'rgba(59,130,246,0.5)' : 'rgba(91,142,201,0.5)'}
            onBlur={e => e.currentTarget.style.borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
          />

          {/* Platform indicator */}
          {platform && platform.id !== 'custom' && (
            <div style={{
              marginTop: 8, display: 'flex',
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
              <span style={{ fontSize: 12, color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)' }}>
                {t('platformDetected', { platform: platform.name })}
              </span>
            </div>
          )}

          {/* Hint text */}
          <p style={{
            marginTop: 8, fontSize: 12,
            color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'
          }}>
            {t('urlInputHint')}
          </p>

          {/* Title input (shown when single URL) */}
          {urlInput.trim() && !urlInput.includes('\n') && !urlInput.includes(',') && (
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={platform?.name ? `${platform.name} course...` : t('courseTitle')}
              style={{
                width: '100%', padding: '8px 12px', marginTop: 12,
                fontSize: 14, borderRadius: 8,
                background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                color: isDark ? '#fff' : '#1f2937',
                outline: 'none',
                transition: 'border-color 0.15s'
              }}
              onFocus={e => e.currentTarget.style.borderColor = isDark ? 'rgba(59,130,246,0.5)' : 'rgba(91,142,201,0.5)'}
              onBlur={e => e.currentTarget.style.borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
            />
          )}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px', fontSize: 14, fontWeight: 500,
                borderRadius: 8, transition: 'background 0.15s',
                background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
                border: 'none', cursor: 'pointer'
              }}
              onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={!urlInput.trim()}
              style={{
                padding: '8px 16px', fontSize: 14, fontWeight: 500,
                borderRadius: 8, transition: 'background 0.15s',
                background: theme.accent, color: '#fff',
                border: 'none', cursor: 'pointer',
                opacity: !urlInput.trim() ? 0.5 : 1
              }}
              onMouseEnter={e => { if (urlInput.trim()) e.currentTarget.style.opacity = '0.8'; }}
              onMouseLeave={e => { if (urlInput.trim()) e.currentTarget.style.opacity = '1'; }}
            >
              {t('addVideo')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
