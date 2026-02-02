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
  const { isDark } = useTheme();

  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [platform, setPlatform] = useState(null);

  // Auto-detect platform from URL
  useEffect(() => {
    if (url.trim().startsWith('http')) {
      const detected = detectPlatform(url.trim());
      setPlatform(detected);
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
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md mx-4 p-5 rounded-2xl shadow-2xl border ${
          isDark ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-black/10'
        }`}
      >
            <h3 className={`text-lg font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-800'}`}>
              {t('addCourseUrl')}
            </h3>

            <form onSubmit={handleSubmit}>
              {/* URL input */}
              <div className="mb-3">
                <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
                  {t('courseUrl')}
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.udemy.com/course/..."
                  autoFocus
                  className={`w-full px-3 py-2.5 text-sm rounded-xl transition-colors ${
                    isDark
                      ? 'bg-white/5 text-white border border-white/10 placeholder:text-white/30 focus:border-primary/50'
                      : 'bg-black/5 text-gray-800 border border-black/10 placeholder:text-gray-400 focus:border-primary/50'
                  } focus:outline-none`}
                />
              </div>

              {/* Platform indicator */}
              {platform && platform.id !== 'custom' && (
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className="w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center text-white"
                    style={{ backgroundColor: getPlatformColor(platform.id) }}
                  >
                    {platform.icon}
                  </span>
                  <span className={`text-xs ${isDark ? 'text-white/60' : 'text-gray-500'}`}>
                    {t('platformDetected', { platform: platform.name })}
                  </span>
                </div>
              )}

              {/* Title input */}
              <div className="mb-4">
                <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-white/50' : 'text-gray-500'}`}>
                  {t('courseTitle')}
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={platform?.name ? `${platform.name} course...` : 'Course title...'}
                  className={`w-full px-3 py-2.5 text-sm rounded-xl transition-colors ${
                    isDark
                      ? 'bg-white/5 text-white border border-white/10 placeholder:text-white/30 focus:border-primary/50'
                      : 'bg-black/5 text-gray-800 border border-black/10 placeholder:text-gray-400 focus:border-primary/50'
                  } focus:outline-none`}
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                    isDark
                      ? 'bg-white/5 text-white/70 hover:bg-white/10'
                      : 'bg-black/5 text-gray-600 hover:bg-black/10'
                  }`}
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={!url.trim()}
                  className="px-4 py-2 bg-primary text-white text-sm rounded-lg font-medium hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
