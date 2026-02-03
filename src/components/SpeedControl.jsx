import { useTheme } from '../theme.jsx';

/**
 * Horizontal segmented speed selector with sliding indicator.
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
  const { isDark, theme } = useTheme();

  const activeIndex = presets.indexOf(speed);
  const itemWidth = compact ? 36 : 44;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        position: 'relative',
        padding: 3,
        borderRadius: 999,
        background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
      }}
    >
      {/* Sliding indicator */}
      <div
        style={{
          position: 'absolute',
          top: 3,
          bottom: 3,
          left: activeIndex >= 0 ? 3 + activeIndex * itemWidth : 3,
          width: itemWidth,
          borderRadius: 999,
          background: theme.accent,
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          opacity: activeIndex >= 0 ? 1 : 0,
        }}
      />

      {/* Speed buttons */}
      {presets.map((preset) => {
        const isActive = speed === preset;
        const label = preset === 1 ? '1x' : `${preset}x`;

        return (
          <button
            key={preset}
            onClick={() => onSelect?.(preset)}
            style={{
              position: 'relative',
              zIndex: 1,
              width: itemWidth,
              padding: compact ? '4px 0' : '6px 0',
              fontSize: compact ? 11 : 12,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              textAlign: 'center',
              border: 'none',
              borderRadius: 999,
              cursor: 'pointer',
              background: 'transparent',
              color: isActive
                ? '#fff'
                : isDark
                  ? 'rgba(255,255,255,0.5)'
                  : 'rgba(0,0,0,0.45)',
              transition: 'color 0.15s',
              userSelect: 'none',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)';
              }
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
};
