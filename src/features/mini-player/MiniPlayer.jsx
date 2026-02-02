import { useState, useEffect, useRef, useCallback } from 'react';
import { VideoPlayer } from '../../components/VideoPlayer';
import { MiniPlayerControls } from './MiniPlayerControls';

const electronAPI = window.electronAPI || null;

const SPEED_PRESETS = [1, 1.25, 1.5, 2, 3];

const loadSpeed = () => {
  try {
    const stored = localStorage.getItem('revid-playback-speed');
    if (stored) {
      const parsed = parseFloat(stored);
      if (SPEED_PRESETS.includes(parsed)) return parsed;
    }
  } catch (e) {
    // Ignore
  }
  return 1;
};

/**
 * MiniPlayer — standalone mini player rendered when ?mode=mini-player.
 * Receives video state via IPC from the main window.
 */
export const MiniPlayer = () => {
  const videoRef = useRef(null);
  const [videoSrc, setVideoSrc] = useState(null);
  const [speed, setSpeed] = useState(loadSpeed);
  const [initialTime, setInitialTime] = useState(0);
  const syncIntervalRef = useRef(null);

  // Listen for init data from main window
  useEffect(() => {
    if (!electronAPI?.onMiniPlayerInit) return;

    electronAPI.onMiniPlayerInit((data) => {
      if (data.src) setVideoSrc(data.src);
      if (data.currentTime) setInitialTime(data.currentTime);
      if (data.playbackRate) {
        setSpeed(data.playbackRate);
      }
    });

    electronAPI.onMiniPlayerUpdate?.((data) => {
      if (data.src && data.src !== videoSrc) {
        setVideoSrc(data.src);
      }
      if (data.playbackRate !== undefined) {
        setSpeed(data.playbackRate);
      }
    });
  }, [videoSrc]);

  // Periodically sync time back to main window
  useEffect(() => {
    syncIntervalRef.current = setInterval(() => {
      const time = videoRef.current?.getCurrentTime?.();
      if (time !== undefined && electronAPI?.sendTimeSync) {
        electronAPI.sendTimeSync({ currentTime: time, speed });
      }
    }, 1000);

    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [speed]);

  const handleSelectSpeed = useCallback((newSpeed) => {
    setSpeed(newSpeed);
    try {
      localStorage.setItem('revid-playback-speed', String(newSpeed));
    } catch (e) {
      // Ignore
    }
    // Sync speed to main window
    electronAPI?.sendTimeSync?.({ playbackRate: newSpeed });
  }, []);

  const handleClose = useCallback(() => {
    // Send final time sync before closing
    const time = videoRef.current?.getCurrentTime?.();
    if (time !== undefined) {
      electronAPI?.sendTimeSync?.({ currentTime: time, speed, closing: true });
    }
    electronAPI?.closeMiniPlayer?.();
  }, [speed]);

  return (
    <div
      className="w-screen h-screen bg-black overflow-hidden relative"
      style={{ WebkitAppRegion: 'drag' }}
    >
      {/* Video player fills the entire window */}
      <div
        className="w-full h-full"
        style={{ WebkitAppRegion: 'no-drag' }}
      >
        {videoSrc ? (
          <VideoPlayer
            ref={videoRef}
            src={videoSrc}
            playbackRate={speed}
            initialTime={initialTime}
            className="w-full h-full"
            minimal
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/40 text-sm">
            Waiting for video...
          </div>
        )}
      </div>

      {/* Controls overlay (shows on hover) */}
      <div style={{ WebkitAppRegion: 'no-drag' }}>
        <MiniPlayerControls
          speed={speed}
          presets={SPEED_PRESETS}
          onSelectSpeed={handleSelectSpeed}
          onClose={handleClose}
        />
      </div>

      {/* Drag handle indicator (top center) */}
      <div
        className="absolute top-1 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-white/20 opacity-0 hover:opacity-100 transition-opacity"
        style={{ WebkitAppRegion: 'drag' }}
      />
    </div>
  );
};
