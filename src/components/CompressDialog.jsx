import { useState, useCallback, useEffect } from 'react';
import { formatFileSize } from '../utils/videoMetadata';

const getElectronAPI = () => window.electronAPI || null;

const STEP = { CONFIG: 'config', PROCESSING: 'processing', DONE: 'done' };

const CRF_PRESETS = [
  { label: 'High', crf: 18, desc: 'Large file, best quality' },
  { label: 'Medium', crf: 23, desc: 'Balanced' },
  { label: 'Low', crf: 28, desc: 'Smaller file' },
  { label: 'Min', crf: 35, desc: 'Smallest file' }
];

const RESOLUTIONS = [
  { label: 'Original', value: null },
  { label: '1080p', value: 1920 },
  { label: '720p', value: 1280 },
  { label: '480p', value: 854 },
  { label: '360p', value: 640 }
];

export const CompressDialog = ({ videoPath, videoDuration, onClose }) => {
  const [crfIdx, setCrfIdx] = useState(1);
  const [resIdx, setResIdx] = useState(0);
  const [step, setStep] = useState(STEP.CONFIG);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleStart = useCallback(async () => {
    const api = getElectronAPI();
    if (!api || !videoPath) return;

    const ext = api.path.extname(videoPath);
    const base = api.path.basename(videoPath, ext);
    const suffix = CRF_PRESETS[crfIdx].label.toLowerCase();
    const { canceled, filePath: outputPath } = await api.showSaveDialog(`${base}-${suffix}.mp4`);
    if (canceled || !outputPath) return;

    setStep(STEP.PROCESSING);
    setProgress(0);
    setError(null);

    try {
      const res = await api.compressVideo({
        inputPath: videoPath,
        outputPath,
        crf: CRF_PRESETS[crfIdx].crf,
        resolution: RESOLUTIONS[resIdx].value,
        totalDuration: videoDuration
      }, (pct) => setProgress(pct));

      setResult(res);
      setStep(STEP.DONE);
      if (!res.success) setError(res.error || 'Failed');
    } catch (err) {
      setError(err.message || String(err));
      setStep(STEP.DONE);
    }
  }, [videoPath, videoDuration, crfIdx, resIdx]);

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
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Compress Video</h3>
          <button onClick={onClose} disabled={step === STEP.PROCESSING}
            style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18, padding: '2px 6px' }}>{'\u2715'}</button>
        </div>

        {step === STEP.CONFIG && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8, display: 'block' }}>Quality</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {CRF_PRESETS.map((p, i) => (
                  <button key={p.label} onClick={() => setCrfIdx(i)} style={{
                    flex: 1, padding: '8px 0', borderRadius: 6, fontSize: 12, fontWeight: 500,
                    background: i === crfIdx ? '#3b82f6' : 'rgba(255,255,255,0.06)',
                    color: i === crfIdx ? '#fff' : 'rgba(255,255,255,0.55)', transition: 'all 0.15s'
                  }}>{p.label}</button>
                ))}
              </div>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>
                {CRF_PRESETS[crfIdx].desc} (CRF {CRF_PRESETS[crfIdx].crf})
              </p>
            </div>

            <div>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8, display: 'block' }}>Resolution</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {RESOLUTIONS.map((r, i) => (
                  <button key={r.label} onClick={() => setResIdx(i)} style={{
                    padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                    background: i === resIdx ? '#3b82f6' : 'rgba(255,255,255,0.06)',
                    color: i === resIdx ? '#fff' : 'rgba(255,255,255,0.55)', transition: 'all 0.15s'
                  }}>{r.label}</button>
                ))}
              </div>
            </div>

            <button className="btn btn-primary" onClick={handleStart} style={{ width: '100%', marginTop: 4 }}>
              Compress Video
            </button>
          </div>
        )}

        {step === STEP.PROCESSING && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 16 }}>Compressing...</p>
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
                <p style={{ fontSize: 14, color: '#4ade80', marginBottom: 8 }}>Compressed</p>
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
