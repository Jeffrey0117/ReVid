import { useEffect, useCallback } from 'react';
import { useTheme } from '../theme.jsx';
import { PictureInPicture } from './icons';

const electronAPI = window.electronAPI || null;

/**
 * MiniPlayerToggle — button + keyboard shortcut (Ctrl+M) to open/close the mini player.
 *
 * Props:
 *   videoSrc       - current video source path/URL
 *   getCurrentTime - function that returns current playback position
 *   playbackRate   - current speed
 *   isMiniPlayerOpen - whether mini player window is open
 *   onMiniPlayerStateChange - callback(isOpen)
 */
export const MiniPlayerToggle = ({
  videoSrc,
  getCurrentTime,
  playbackRate = 1,
  isMiniPlayerOpen = false,
  onMiniPlayerStateChange
}) => {
  const { isDark } = useTheme();

  const toggleMiniPlayer = useCallback(() => {
    if (!electronAPI) return;

    if (isMiniPlayerOpen) {
      electronAPI.closeMiniPlayer?.();
      onMiniPlayerStateChange?.(false);
    } else {
      const currentTime = getCurrentTime?.() ?? 0;
      electronAPI.openMiniPlayer?.({
        src: videoSrc,
        currentTime,
        playbackRate
      });
      onMiniPlayerStateChange?.(true);
    }
  }, [isMiniPlayerOpen, videoSrc, getCurrentTime, playbackRate, onMiniPlayerStateChange]);

  // Keyboard shortcut: Ctrl+M
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
        e.preventDefault();
        toggleMiniPlayer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleMiniPlayer]);

  // Listen for mini player closed event
  useEffect(() => {
    if (!electronAPI?.onMiniPlayerClosed) return;
    electronAPI.onMiniPlayerClosed(() => {
      onMiniPlayerStateChange?.(false);
    });
  }, [onMiniPlayerStateChange]);

  if (!electronAPI || !videoSrc) return null;

  return (
    <button
      onClick={toggleMiniPlayer}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
        isMiniPlayerOpen
          ? 'bg-primary/20 text-primary'
          : isDark
            ? 'bg-white/5 hover:bg-white/10 text-white/60'
            : 'bg-black/5 hover:bg-black/10 text-gray-500'
      }`}
      title={`${isMiniPlayerOpen ? 'Close' : 'Open'} Mini Player (Ctrl+M)`}
    >
      <PictureInPicture size={14} />
    </button>
  );
};
