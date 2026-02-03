import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../theme.jsx';
import { useI18n } from '../../i18n.jsx';
import { createRevidFile, createRevidCollection, generateRevidFileName } from '../../utils/revidFile';

const getElectronAPI = () => window.electronAPI || null;

/**
 * ExportDialog — three export modes:
 * 1. Export current video → single .revid
 * 2. Export current folder → batch .revid to directory
 * 3. Export all data → JSON backup
 */
export const ExportDialog = ({ isOpen, onClose, activeCourse, selectedFolder, folders }) => {
  const { t } = useI18n();
  const { theme, isDark } = useTheme();

  const [includeProgress, setIncludeProgress] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState(null);

  const handleExportCurrentVideo = async () => {
    if (!activeCourse) return;
    const api = getElectronAPI();
    if (!api) return;

    setIsExporting(true);
    setResult(null);

    try {
      const revidData = createRevidFile(activeCourse, { includeProgress });
      const defaultName = generateRevidFileName(activeCourse.title);
      const dialogResult = await api.saveRevidFileDialog(defaultName);

      if (dialogResult?.success && dialogResult.filePath) {
        const writeResult = await api.writeRevidFile(dialogResult.filePath, revidData);
        if (writeResult?.success) {
          setResult({ success: true, message: t('exportSuccess') });
        } else {
          setResult({ success: false, message: writeResult?.error || t('exportFailed') });
        }
      }
    } catch (e) {
      setResult({ success: false, message: e.message });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportFolder = async () => {
    if (!selectedFolder) return;
    const api = getElectronAPI();
    if (!api) return;

    setIsExporting(true);
    setResult(null);

    try {
      const dirResult = await api.selectOutputDirectory();
      if (!dirResult) {
        setIsExporting(false);
        return;
      }

      const courses = (selectedFolder.courses || []).filter(c => !c.deletedAt);
      const files = courses.map(course => ({
        fileName: generateRevidFileName(course.title),
        data: createRevidFile(course, { includeProgress }),
      }));

      const writeResult = await api.writeRevidFilesBatch(dirResult, files);
      if (writeResult?.success) {
        setResult({ success: true, message: t('filesExported').replace('{count}', String(writeResult.count)) });
      } else {
        setResult({ success: false, message: writeResult?.error || t('exportFailed') });
      }
    } catch (e) {
      setResult({ success: false, message: e.message });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportAll = async () => {
    const api = getElectronAPI();
    if (!api) return;

    setIsExporting(true);
    setResult(null);

    try {
      const collection = createRevidCollection(folders, { includeProgress });
      const defaultName = `revid-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const exportResult = await api.exportTheaterData(collection, defaultName);

      if (exportResult?.success) {
        setResult({ success: true, message: t('exportSuccess') });
      } else if (!exportResult?.canceled) {
        setResult({ success: false, message: exportResult?.error || t('exportFailed') });
      }
    } catch (e) {
      setResult({ success: false, message: e.message });
    } finally {
      setIsExporting(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    setIsExporting(false);
    onClose?.();
  };

  if (!isOpen) return null;

  const buttonStyle = (enabled) => ({
    width: '100%', padding: '12px 16px',
    borderRadius: 10, border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
    background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.4,
    transition: 'background 0.15s',
    textAlign: 'left',
  });

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
          width: 420, maxWidth: '90vw',
          padding: 20, borderRadius: 16,
          background: isDark ? '#1a1a1a' : '#fff',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
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
            {t('exportData')}
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

        {/* Export options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* 1. Current video */}
          <button
            onClick={handleExportCurrentVideo}
            disabled={!activeCourse || isExporting}
            style={buttonStyle(!!activeCourse && !isExporting)}
            onMouseEnter={e => { if (activeCourse) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'; }}
            onMouseLeave={e => { if (activeCourse) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'; }}
          >
            <div style={{ fontSize: 14, fontWeight: 500, color: isDark ? '#fff' : '#1f2937', marginBottom: 2 }}>
              {t('exportCurrentVideo')}
            </div>
            <div style={{ fontSize: 12, color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' }}>
              {t('exportAsRevid')}
            </div>
          </button>

          {/* 2. Current folder */}
          <button
            onClick={handleExportFolder}
            disabled={!selectedFolder || isExporting}
            style={buttonStyle(!!selectedFolder && !isExporting)}
            onMouseEnter={e => { if (selectedFolder) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'; }}
            onMouseLeave={e => { if (selectedFolder) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'; }}
          >
            <div style={{ fontSize: 14, fontWeight: 500, color: isDark ? '#fff' : '#1f2937', marginBottom: 2 }}>
              {t('exportCurrentFolder')}
            </div>
            <div style={{ fontSize: 12, color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' }}>
              {t('exportFolderAsRevid')}
            </div>
          </button>

          {/* 3. All data */}
          <button
            onClick={handleExportAll}
            disabled={isExporting}
            style={buttonStyle(!isExporting)}
            onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}
            onMouseLeave={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'}
          >
            <div style={{ fontSize: 14, fontWeight: 500, color: isDark ? '#fff' : '#1f2937', marginBottom: 2 }}>
              {t('exportAllData')}
            </div>
            <div style={{ fontSize: 12, color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)' }}>
              {t('exportAsJson')}
            </div>
          </button>
        </div>

        {/* Include progress checkbox */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginTop: 14, cursor: 'pointer',
          fontSize: 13, color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)',
        }}>
          <input
            type="checkbox"
            checked={includeProgress}
            onChange={(e) => setIncludeProgress(e.target.checked)}
            style={{ accentColor: theme.accent }}
          />
          {t('includeProgress')}
        </label>

        {/* Result message */}
        {result && (
          <div style={{
            marginTop: 12, padding: '8px 12px',
            borderRadius: 8, fontSize: 13,
            background: result.success
              ? (isDark ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.1)')
              : (isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)'),
            color: result.success
              ? (isDark ? '#4ade80' : '#16a34a')
              : (isDark ? '#f87171' : '#dc2626'),
          }}>
            {result.message}
          </div>
        )}

        {/* Loading */}
        {isExporting && (
          <div style={{
            marginTop: 12, fontSize: 13,
            color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)',
          }}>
            {t('exporting')}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
