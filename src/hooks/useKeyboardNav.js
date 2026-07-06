import { useEffect } from 'react';

export const useKeyboardNav = ({ onNext, onPrev, enabled = true }) => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e) => {
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.tagName === 'VIDEO'
      ) {
        return;
      }

      // Arrow keys are intentionally NOT bound here — the video player owns
      // ←/→ for seeking. Use n/p (next/previous) to switch videos.
      switch (e.key) {
        case 'n':
        case 'N':
          e.preventDefault();
          onNext();
          break;
        case 'p':
        case 'P':
          e.preventDefault();
          onPrev();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNext, onPrev, enabled]);
};
