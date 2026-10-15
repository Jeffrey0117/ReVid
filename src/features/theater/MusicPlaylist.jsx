import React, { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import { extractYouTubeVideoId } from '../../utils/youtubeUrl';

// Track list shown beside the full music-album view. Styled dark to match the
// album overlay regardless of the app theme.

const isUrlTitle = (title) => /^https?:\/\//i.test(title || '');

const thumbOf = (course) => {
  const id = extractYouTubeVideoId(course.url);
  return id ? `https://img.youtube.com/vi/${id}/default.jpg` : null;
};

const TrackRow = ({ course, index, isCurrent, onSelect, fallbackLabel }) => {
  const thumb = thumbOf(course);
  const title = isUrlTitle(course.title) || !course.title
    ? `${fallbackLabel} ${index + 1}`
    : course.title;
  return (
    <div
      data-current={isCurrent || undefined}
      onClick={() => onSelect(course.id)}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px', cursor: 'pointer',
        background: isCurrent ? 'rgba(29,185,84,0.16)' : 'transparent',
        transition: 'background .12s'
      }}
      onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{
        width: 22, flexShrink: 0, textAlign: 'right', fontSize: 12,
        fontVariantNumeric: 'tabular-nums',
        color: isCurrent ? '#1db954' : 'rgba(255,255,255,0.35)'
      }}>
        {isCurrent ? '♪' : index + 1}
      </span>
      <div style={{ width: 40, height: 40, borderRadius: 4, overflow: 'hidden', flexShrink: 0, background: '#222' }}>
        {thumb && <img src={thumb} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </div>
      <div style={{
        flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.35,
        fontWeight: isCurrent ? 600 : 400,
        color: isCurrent ? '#1db954' : 'rgba(255,255,255,0.85)',
        overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'
      }}>
        {title}
      </div>
    </div>
  );
};

export const MusicPlaylist = ({ courses, currentId, folderName, onSelect, onHide }) => {
  const { t } = useI18n();
  const listRef = useRef(null);

  // Keep the playing track in view when it changes (auto-advance, next/prev).
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-current]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);

  return (
    <aside style={{
      width: 300, maxWidth: '40%', flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      background: '#121215', borderLeft: '1px solid rgba(255,255,255,0.07)'
    }}>
      <div style={{ padding: '14px 14px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#fff', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {folderName || t('musicPlaylist')}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2 }}>
            {courses.length} {t('items')}
          </div>
        </div>
        <button
          onClick={onHide}
          title={t('hidePlaylist')}
          style={{
            width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        {courses.map((course, idx) => (
          <TrackRow
            key={course.id}
            course={course}
            index={idx}
            isCurrent={course.id === currentId}
            onSelect={onSelect}
            fallbackLabel={t('trackFallback')}
          />
        ))}
      </div>
    </aside>
  );
};
