import { useState, useCallback, useEffect } from 'react';
import { formatDuration } from '../utils/videoMetadata';

const getElectronAPI = () => window.electronAPI || null;

const STEP = { CONFIG: 'config', PROCESSING: 'processing', DONE: 'done' };

export const GifDialog = ({ videoPath, videoDuration, onClose }) => {
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(Math.min(5, videoDuration));
  const [fps, setFps] = useState(10);
  const [width, setWidth] = useState(480);
  const [step, setStep] = useState(STEP.CONFIG);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const duration = Math.max(0.1, endTime - startTime);

  useEffect(() => {
    if (videoDuration > 0 && endTime > videoDuration) {
      setEndTime(videoDuration);
    }
  }, [videoDuration, endTime]);

  const handleStart = useCallback(async () => {
    const api = getElectronAPI();
    if (!api || !videoPath) return;

    const ext = api.path.extname(videoPath);
    const base = api.path.basename(videoPath, ext);
    const { canceled, filePath: outputPath } = await api.showSaveDialog(`${base}.gif`);
    if (canceled || !outputPath) return;

    setStep(STEP.PROCESSING);
    setProgress(0);
    setError(null);

    try {
      const res = await api.createGif({
        inputPath: videoPath,
        outputPath,
        startTime,
        duration,
        fps,
        width
      }, (pct) => setProgress(pct));

      setResult(res);
      setStep(STEP.DONE);
      if (!res.success) {
        setError(res.error || 'Failed');
      }
    } catch (err) {
      setError(err.message || String(err));
      setStep(STEP.DONE);
    }
  }, [videoPath, startTime, duration, fps, width]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const inputStyle = {
    width: '100%', padding: '8px 12px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6, color: '#fff', fontSize: 14,
    outline: 'none'
  };

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
        width: 400,
        maxWidth: '90vw'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 20
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>
            Create GIF
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Time range */}
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6, display: 'block' }}>
                  Start (seconds)
                </label>
                <input
                  type="number"
                  min={0}
                  max={videoDuration}
                  step={0.1}
                  value={startTime}
                  onChange={(e) => setStartTime(Math.max(0, parseFloat(e.target.value) || 0))}
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6, display: 'block' }}>
                  End (seconds)
                </label>
                <input
                  type="number"
                  min={0}
                  max={videoDuration}
                  step={0.1}
                  value={endTime}
                  onChange={(e) => setEndTime(Math.min(videoDuration, Math.max(startTime + 0.1, parseFloat(e.target.value) || 0)))}
                  style={inputStyle}
                />
              </div>
            </div>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: -8 }}>
              Duration: {formatDuration(duration)} (total: {formatDuration(videoDuration)})
            </p>

            {/* FPS + Width */}
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6, display: 'block' }}>
                  FPS
                </label>
                <select
                  value={fps}
                  onChange={(e) => setFps(parseInt(e.target.value))}
                  style={inputStyle}
                >
                  <option value={5}>5 fps</option>
                  <option value={10}>10 fps</option>
                  <option value={15}>15 fps</option>
                  <option value={20}>20 fps</option>
                  <option value={25}>25 fps</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6, display: 'block' }}>
                  Width (px)
                </label>
                <select
                  value={width}
                  onChange={(e) => setWidth(parseInt(e.target.value))}
                  style={inputStyle}
                >
                  <option value={240}>240</option>
                  <option value={320}>320</option>
                  <option value={480}>480</option>
                  <option value={640}>640</option>
                  <option value={800}>800</option>
                </select>
              </div>
            </div>

            {/* Start button */}
            <button
              className="btn btn-primary"
              onClick={handleStart}
              disabled={duration <= 0}
              style={{ width: '100%', marginTop: 4 }}
            >
              Create GIF
            </button>
          </div>
        )}

        {step === STEP.PROCESSING && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 16 }}>
              Creating GIF...
            </p>
            <div style={{ width: '100%', background: 'rgba(255,255,255,0.06)', borderRadius: 999, height: 8, overflow: 'hidden' }}>
              <div style={{
                height: '100%', background: '#3b82f6', borderRadius: 999,
                transition: 'width 0.3s', width: `${progress}%`
              }} />
            </div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 8 }}>
              {progress}%
            </p>
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
                <p style={{ fontSize: 14, color: '#4ade80', marginBottom: 8 }}>
                  GIF created
                </p>
                {result?.fileSize > 0 && (
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                    {(result.fileSize / (1024 * 1024)).toFixed(1)} MB
                  </p>
                )}
              </>
            )}
            <button
              className="btn btn-ghost"
              onClick={onClose}
              style={{ marginTop: 16 }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
