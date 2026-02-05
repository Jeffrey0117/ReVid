import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../theme.jsx';
import { useI18n } from '../../i18n.jsx';

/**
 * BatchRenameCourseDialog — batch rename courses with template
 *
 * Props:
 *   isOpen    - dialog visibility
 *   onClose   - close callback
 *   courses   - array of courses to rename
 *   onRename  - callback(courseId, newTitle) called per course
 */
export const BatchRenameCourseDialog = ({ isOpen, onClose, courses, onRename }) => {
  const { t } = useI18n();
  const { theme, isDark } = useTheme();

  const [template, setTemplate] = useState('第{n}集');
  const [startNum, setStartNum] = useState(1);
  const [previews, setPreviews] = useState([]);

  // Generate previews when template or startNum changes
  useEffect(() => {
    if (!courses || courses.length === 0) return;

    const newPreviews = courses.map((course, index) => {
      const num = startNum + index;
      const newTitle = template
        .replace('{n}', num)
        .replace('{title}', course.title || '')
        .replace('{i}', index + 1);
      return { id: course.id, original: course.title, newTitle };
    });
    setPreviews(newPreviews);
  }, [courses, template, startNum]);

  const handleApply = () => {
    for (const preview of previews) {
      if (preview.newTitle && preview.newTitle !== preview.original) {
        onRename?.(preview.id, preview.newTitle);
      }
    }
    onClose?.();
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: isDark ? '#1f1f1f' : '#fff',
          borderRadius: 16,
          padding: 24,
          width: 480,
          maxWidth: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          fontSize: 16, fontWeight: 600,
          color: isDark ? '#fff' : '#1f2937',
          marginBottom: 16
        }}>
          {t('batchRename') || '批次命名'}
        </div>

        {/* Template input */}
        <div style={{ marginBottom: 16 }}>
          <label style={{
            fontSize: 12, color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)',
            display: 'block', marginBottom: 6
          }}>
            {t('nameTemplate') || '命名模板'}
          </label>
          <input
            type="text"
            value={template}
            onChange={e => setTemplate(e.target.value)}
            placeholder="第{n}集"
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
              background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              color: isDark ? '#fff' : '#1f2937',
              fontSize: 14,
              outline: 'none'
            }}
          />
          <div style={{
            fontSize: 11, color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
            marginTop: 4
          }}>
            {t('templateHint') || '可用變數: {n}=編號, {title}=原標題, {i}=序號'}
          </div>
        </div>

        {/* Start number */}
        <div style={{ marginBottom: 16 }}>
          <label style={{
            fontSize: 12, color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)',
            display: 'block', marginBottom: 6
          }}>
            {t('startNumber') || '起始編號'}
          </label>
          <input
            type="number"
            value={startNum}
            onChange={e => setStartNum(parseInt(e.target.value) || 1)}
            min={1}
            style={{
              width: 80,
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
              background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              color: isDark ? '#fff' : '#1f2937',
              fontSize: 14,
              outline: 'none'
            }}
          />
        </div>

        {/* Preview list */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          marginBottom: 16,
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
          borderRadius: 8
        }}>
          <div style={{
            padding: '8px 12px',
            background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
            borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
            fontSize: 12, fontWeight: 500,
            color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)'
          }}>
            {t('preview') || '預覽'} ({previews.length})
          </div>
          {previews.map((item, idx) => (
            <div
              key={item.id}
              style={{
                padding: '10px 12px',
                borderBottom: idx < previews.length - 1
                  ? `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`
                  : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              <span style={{
                fontSize: 11, color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
                minWidth: 20
              }}>
                {idx + 1}
              </span>
              <span style={{
                fontSize: 12,
                color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)',
                textDecoration: 'line-through',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {item.original}
              </span>
              <span style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)' }}>→</span>
              <span style={{
                fontSize: 12,
                color: theme.accent,
                fontWeight: 500,
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {item.newTitle}
              </span>
            </div>
          ))}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
              color: isDark ? '#fff' : '#1f2937',
              fontSize: 14,
              cursor: 'pointer'
            }}
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleApply}
            disabled={previews.length === 0}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              background: theme.accent,
              color: '#fff',
              fontSize: 14,
              fontWeight: 500,
              cursor: previews.length > 0 ? 'pointer' : 'default',
              opacity: previews.length > 0 ? 1 : 0.5
            }}
          >
            {t('apply') || '套用'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
