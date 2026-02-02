import { useState, useCallback, useEffect, useMemo } from 'react';
import { getVideoMetadata, formatDuration } from '../utils/videoMetadata';

const getElectronAPI = () => window.electronAPI || null;

const STEP = { CONFIG: 'config', PROCESSING: 'processing', DONE: 'done' };

const PRESETS = [
  { label: '16:9', ar: 16 / 9 },
  { label: '9:16', ar: 9 / 16 },
  { label: '1:1', ar: 1 },
  { label: '4:3', ar: 4 / 3 },
  { label: '4:5', ar: 4 / 5 }
];

function computeCenterCrop(videoW, videoH, targetAr) {
  let cropW, cropH;
  const videoAr = videoW / videoH;

  if (targetAr > videoAr) {
    cropW = videoW;
    cropH = Math.round(videoW / targetAr);
  } else {
    cropH = videoH;
    cropW = Math.round(videoH * targetAr);
  }

  cropW = cropW % 2 === 0 ? cropW : cropW - 1;
  cropH = cropH % 2 === 0 ? cropH : cropH - 1;

  return {
    x: Math.round((videoW - cropW) / 2),
    y: Math.round((videoH - cropH) / 2),
    width: cropW,
    height: cropH
  };
}

export const BatchCropDialog = ({ files, currentVideo, onClose }) => {
  const [presetIdx, setPresetIdx] = useState(0);
  const [selected, setSelected] = useState(() => new Set(files));
  const [step, setStep] = useState(STEP.CONFIG);
  const [progressFile, setProgressFile] = useState('');
  const [progressIdx, setProgressIdx] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const [results, setResults] = useState({ success: 0, failed: 0 });
  const [error, setError] = useState(null);

  const api = getElectronAPI();

  const getFileName = useCallback((filePath) => {
    if (api?.path?.basename) return api.path.basename(filePath);
    return filePath.split(/[\\/]/).pop() || filePath;
  }, [api]);

  const toggleFile = useCallback((file) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected(prev => prev.size === files.length ? new Set() : new Set(files));
  }, [files]);

  const handleStart = useCallback(async () => {
    if (!api || selected.size === 0) return;

    const dir = await api.selectOutputDirectory();
    if (!dir) return;

    setStep(STEP.PROCESSING);
    setError(null);
    const ar = PRESETS[presetIdx].ar;

    let success = 0;
    let failed = 0;
    const selectedArr = [...selected];

    for (let i = 0; i < selectedArr.length; i++) {
      const file = selectedArr[i];
      setProgressFile(getFileName(file));
      setProgressIdx(i + 1);
      setProgressPct(0);

      try {
        const videoUrl = `local-video:///${file.replace(/\\/g, '/')}`;
        const meta = await getVideoMetadata(videoUrl);

        if (!meta || !meta.width || !meta.height) {
          failed++;
          continue;
        }

        const crop = computeCenterCrop(meta.width, meta.height, ar);
        const ext = api.path.extname(file);
        const base = api.path.basename(file, ext);
        const outputPath = api.path.join(dir, `${base}-cropped.mp4`);

        const result = await api.cropVideo({
          inputPath: file,
          outputPath,
          crop,
          trim: null,
          totalDuration: meta.duration || 10
        }, (pct) => setProgressPct(pct));

        if (result.success) success++;
        else failed++;
      } catch {
        failed++;
      }
    }

    setResults({ success, failed });
    setStep(STEP.DONE);
  }, [api, selected, presetIdx, getFileName]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && step !== STEP.PROCESSING) onClose();
  }, [onClose, step]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
      onClick={(e) => { if (e.target === e.currentTarget && step !== STEP.PROCESSING) onClose(); }}
    >
      <div style={{
        background: '#1a1a1a',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.1)',
        padding: 24,
        width: 440,
        maxWidth: '90vw',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 20, flexShrink: 0
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>
            Batch Crop
          </h3>
          <button
            onClick={onClose}
            disabled={step === STEP.PROCESSING}
            style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18, padding: '2px 6px' }}
          >
            {'\u2715'}
          </button>
        </div>

        {step === STEP.CONFIG && (
          <>
            {/* Aspect ratio presets */}
            <div style={{ marginBottom: 16, flexShrink: 0 }}>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8, display: 'block' }}>
                Crop aspect ratio (center crop)
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                {PRESETS.map((p, i) => (
                  <button
                    key={p.label}
                    onClick={() => setPresetIdx(i)}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 6, fontSize: 12, fontWeight: 500,
                      background: i === presetIdx ? '#3b82f6' : 'rgba(255,255,255,0.06)',
                      color: i === presetIdx ? '#fff' : 'rgba(255,255,255,0.55)',
                      transition: 'all 0.15s'
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* File selection */}
            <div style={{ marginBottom: 16, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                  Videos ({selected.size}/{files.length})
                </label>
                <button
                  onClick={toggleAll}
                  style={{ fontSize: 11, color: '#3b82f6', padding: '2px 6px' }}
                >
                  {selected.size === files.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
            </div>

            <div style={{
              flex: 1, overflow: 'auto', marginBottom: 16,
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8, maxHeight: 240
            }}>
              {files.map(file => {
                const isSelected = selected.has(file);
                const isCurrent = file === currentVideo;
                return (
                  <div
                    key={file}
                    onClick={() => toggleFile(file)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px', cursor: 'pointer',
                      background: isSelected ? 'rgba(59,130,246,0.08)' : 'transparent',
                      borderBottom: '1px solid rgba(255,255,255,0.04)'
                    }}
                  >
                    <div style={{
                      width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                      border: isSelected ? '2px solid #3b82f6' : '2px solid rgba(255,255,255,0.2)',
                      background: isSelected ? '#3b82f6' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </div>
                    <span style={{
                      fontSize: 12,
                      color: isCurrent ? '#3b82f6' : 'rgba(255,255,255,0.7)',
                      fontWeight: isCurrent ? 600 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      {getFileName(file)}
                    </span>
                  </div>
                );
              })}
            </div>

            <button
              className="btn btn-primary"
              onClick={handleStart}
              disabled={selected.size === 0}
              style={{ width: '100%', flexShrink: 0 }}
            >
              Crop {selected.size} Videos ({PRESETS[presetIdx].label})
            </button>
          </>
        )}

        {step === STEP.PROCESSING && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>
              Processing {progressIdx}/{selected.size}
            </p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 16,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {progressFile}
            </p>
            <div style={{ width: '100%', background: 'rgba(255,255,255,0.06)', borderRadius: 999, height: 8, overflow: 'hidden' }}>
              <div style={{
                height: '100%', background: '#3b82f6', borderRadius: 999,
                transition: 'width 0.3s', width: `${progressPct}%`
              }} />
            </div>
          </div>
        )}

        {step === STEP.DONE && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontSize: 14, color: '#4ade80', marginBottom: 8 }}>
              Batch crop complete
            </p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
              {results.success} succeeded{results.failed > 0 ? `, ${results.failed} failed` : ''}
            </p>
            <button className="btn btn-ghost" onClick={onClose} style={{ marginTop: 16 }}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
