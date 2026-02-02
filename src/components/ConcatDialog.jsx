import { useState, useCallback, useEffect, useMemo } from 'react';
import { formatFileSize, formatDuration, getVideoMetadata } from '../utils/videoMetadata';

const getElectronAPI = () => window.electronAPI || null;

const STEP = { CONFIG: 'config', PROCESSING: 'processing', DONE: 'done' };

export const ConcatDialog = ({ files, onClose }) => {
  const [selected, setSelected] = useState(() => [...files]);
  const [step, setStep] = useState(STEP.CONFIG);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [durations, setDurations] = useState({});

  const api = getElectronAPI();

  const getFileName = useCallback((filePath) => {
    if (api?.path?.basename) return api.path.basename(filePath);
    return filePath.split(/[\\/]/).pop() || filePath;
  }, [api]);

  // Load durations
  useEffect(() => {
    let cancelled = false;
    const loadDurations = async () => {
      const durs = {};
      for (const file of files) {
        if (cancelled) break;
        const videoUrl = `local-video:///${file.replace(/\\/g, '/')}`;
        const meta = await getVideoMetadata(videoUrl);
        if (meta) durs[file] = meta.duration;
      }
      if (!cancelled) setDurations(durs);
    };
    loadDurations();
    return () => { cancelled = true; };
  }, [files]);

  const totalDuration = useMemo(() => {
    return selected.reduce((sum, f) => sum + (durations[f] || 0), 0);
  }, [selected, durations]);

  const toggleFile = useCallback((file) => {
    setSelected(prev => {
      if (prev.includes(file)) return prev.filter(f => f !== file);
      return [...prev, file];
    });
  }, []);

  const moveUp = useCallback((idx) => {
    if (idx <= 0) return;
    setSelected(prev => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }, []);

  const moveDown = useCallback((idx) => {
    setSelected(prev => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }, []);

  const handleStart = useCallback(async () => {
    if (!api || selected.length < 2) return;

    const ext = api.path.extname(selected[0]);
    const base = api.path.basename(selected[0], ext);
    const { canceled, filePath: outputPath } = await api.showSaveDialog(`${base}-concat.mp4`);
    if (canceled || !outputPath) return;

    setStep(STEP.PROCESSING);
    setProgress(0);
    setError(null);

    try {
      const res = await api.concatVideos({
        inputPaths: selected,
        outputPath,
        totalDuration
      }, (pct) => setProgress(pct));

      setResult(res);
      setStep(STEP.DONE);
      if (!res.success) setError(res.error || 'Failed');
    } catch (err) {
      setError(err.message || String(err));
      setStep(STEP.DONE);
    }
  }, [api, selected, totalDuration]);

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
        background: '#1a1a1a', borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.1)',
        padding: 24, width: 480, maxWidth: '90vw',
        maxHeight: '80vh', display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexShrink: 0 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Concat Videos</h3>
          <button onClick={onClose} disabled={step === STEP.PROCESSING}
            style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18, padding: '2px 6px' }}>{'\u2715'}</button>
        </div>

        {step === STEP.CONFIG && (
          <>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 12, flexShrink: 0 }}>
              {selected.length} videos selected {'\u00b7'} {formatDuration(totalDuration)} total
            </p>

            <div style={{
              flex: 1, overflow: 'auto', marginBottom: 16,
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8, maxHeight: 340
            }}>
              {selected.map((file, idx) => (
                <div key={file} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px',
                  borderBottom: '1px solid rgba(255,255,255,0.04)'
                }}>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', width: 20, textAlign: 'center', flexShrink: 0 }}>
                    {idx + 1}
                  </span>
                  <span style={{
                    fontSize: 12, color: 'rgba(255,255,255,0.7)', flex: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}>
                    {getFileName(file)}
                  </span>
                  {durations[file] > 0 && (
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>
                      {formatDuration(durations[file])}
                    </span>
                  )}
                  <button onClick={() => moveUp(idx)} disabled={idx === 0}
                    style={{ padding: 2, color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>{'\u25B2'}</button>
                  <button onClick={() => moveDown(idx)} disabled={idx === selected.length - 1}
                    style={{ padding: 2, color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>{'\u25BC'}</button>
                  <button onClick={() => toggleFile(file)}
                    style={{ padding: 2, color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>{'\u2715'}</button>
                </div>
              ))}
            </div>

            {/* Add files not in selected */}
            {files.filter(f => !selected.includes(f)).length > 0 && (
              <div style={{ marginBottom: 12, flexShrink: 0 }}>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>Available:</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {files.filter(f => !selected.includes(f)).map(file => (
                    <button
                      key={file}
                      onClick={() => setSelected(prev => [...prev, file])}
                      style={{
                        padding: '3px 8px', borderRadius: 4, fontSize: 10,
                        background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150
                      }}
                    >
                      + {getFileName(file)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 12, flexShrink: 0 }}>
              Videos must have the same codec/resolution for stream copy. Re-encode first if needed.
            </p>

            <button
              className="btn btn-primary"
              onClick={handleStart}
              disabled={selected.length < 2}
              style={{ width: '100%', flexShrink: 0 }}
            >
              Concat {selected.length} Videos
            </button>
          </>
        )}

        {step === STEP.PROCESSING && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 16 }}>Joining videos...</p>
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
                <p style={{ fontSize: 14, color: '#4ade80', marginBottom: 8 }}>Videos joined</p>
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
