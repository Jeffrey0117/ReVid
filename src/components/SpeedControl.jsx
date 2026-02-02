import { useTheme } from '../theme.jsx';

/**
 * Horizontal pill-button speed selector.
 * Can be embedded inside VideoPlayer or used standalone.
 *
 * Props:
 *   speed       - current playback speed (number)
 *   presets     - array of speed values (default: [1, 1.25, 1.5, 2, 3])
 *   onSelect    - callback when a speed is selected
 *   compact     - smaller variant for mini player (default: false)
 */
export const SpeedControl = ({
  speed,
  presets = [1, 1.25, 1.5, 2, 3],
  onSelect,
  compact = false
}) => {
  const { isDark } = useTheme();

  return (
    <div className="flex items-center gap-1">
      {presets.map((preset) => {
        const isActive = speed === preset;
        const label = `${preset}x`;

        return (
          <button
            key={preset}
            onClick={() => onSelect?.(preset)}
            className={`
              rounded-full font-medium transition-all select-none
              ${compact ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'}
              ${isActive
                ? 'bg-primary text-white shadow-sm'
                : isDark
                  ? 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'
                  : 'bg-black/5 text-gray-500 hover:bg-black/10 hover:text-gray-700'
              }
            `}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
};
