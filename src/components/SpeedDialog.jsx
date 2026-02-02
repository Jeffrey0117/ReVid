import { useState, useCallback, useEffect } from 'react';
import { formatFileSize, formatDuration } from '../utils/videoMetadata';

const getElectronAPI = () => window.electronAPI || null;

const STEP = { CONFIG: 'config', PROCESSING: 'processing', DONE: 'done' };

const SPEEDS = [
  { label: '0.25x', value: 0.25 },
  { label: '0.5x', value: 0.5 },
  { label: '0.75x', value: 0.75 },
  { label: '1.5x', value: 1.5 },
  { label: '2x', value: 2 },
  { label: '4x', value: 4 }
];

export const SpeedDialog = ({ videoPath, videoDuration, onClose }) => {
  const [speedIdx, setSpeedIdx] = useState(4); // default 2x
  const [step, setStep] = useState(STEP.CONFIG);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const outputDuration = videoDuration / SPEEDS[speedIdx].value;

  const handleStart = useCallback(async () => {
    const api = getElectronAPI();
    if (!api || !videoPath) return;

    const speed = SPEEDS[speedIdx];
    const ext = api.path.extname(videoPath);
    const base = api.path.basename(videoPath, ext);
    const { canceled, filePath: outputPath } = await api.showSaveDialog(`${base}-${speed.label}.mp4`);
    if (canceled || !outputPath) return;

    setStep(STEP.PROCESSING);
    setProgress(0);
    setError(null);

    try {
      const res = await api.speedVideo({
        inputPath: videoPath,
        outputPath,
        speed: speed.value,
        totalDuration: videoDuration
      }, (pct) => setProgress(pct));

      setResult(res);
      setStep(STEP.DONE);
      if (!res.success) setError(res.error || 'Failed');
    } catch (err) {
      setError(err.message || String(err));
      setStep(STEP.DONE);
    }
  }, [videoPath, videoDuration, speedIdx]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

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
        background: '#1a1a1a', borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.1)',
        padding: 24, width: 400, maxWidth: '90vw'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Speed Output</h3>
          <button onClick={onClose} disabled={step === STEP.PROCESSING}
            style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18, padding: '2px 6px' }}>{'\u2715'}</button>
        </div>

        {step === STEP.CONFIG && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8, display: 'block' }}>Speed</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {SPEEDS.map((s, i) => (
                  <button key={s.label} onClick={() => setSpeedIdx(i)} style={{
                    padding: '8px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                    background: i === speedIdx ? '#3b82f6' : 'rgba(255,255,255,0.06)',
                    color: i === speedIdx ? '#fff' : 'rgba(255,255,255,0.55)', transition: 'all 0.15s'
                  }}>{s.label}</button>
                ))}
              </div>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 8 }}>
                {formatDuration(videoDuration)} {'\u2192'} {formatDuration(outputDuration)}
              </p>
            </div>

            <button className="btn btn-primary" onClick={handleStart} style={{ width: '100%', marginTop: 4 }}>
              Export at {SPEEDS[speedIdx].label}
            </button>
          </div>
        )}

        {step === STEP.PROCESSING && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 16 }}>Processing at {SPEEDS[speedIdx].label}...</p>
            <div style={{ width: '100%', background: 'rgba(255,255,255,0.06)', borderRadius: 999, height: 8, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: '#3b82f6', borderRadius: 999, transition: 'width 0.3s', width: `${progress}%` }} />
            </div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 8 }}>{progress}%</p>
          </div>
        )}

        {step === STEP.DONE && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            {error ? (
              <>
                <p style={{ fontSize: 14, color: '#f87171', marginBottom: 8 }}>Failed</p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{error}</p>
              </>
            ) : (
              <>
                <p style={{ fontSize: 14, color: '#4ade80', marginBottom: 8 }}>Exported at {SPEEDS[speedIdx].label}</p>
                {result?.fileSize > 0 && (
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{formatFileSize(result.fileSize)}</p>
                )}
              </>
            )}
            <button className="btn btn-ghost" onClick={onClose} style={{ marginTop: 16 }}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
};
