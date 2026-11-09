import { useEffect, useState } from 'react';
import { visibleCue, marksForChunk } from '../../utils/cueChunks';
import { ClickableText } from './WordLookup';

// One cue, shown two lines at a time.
//
// Whisper hands back a segment per utterance and an utterance can be six
// sentences long. Rendered whole, that cue is a seven-line slab across the
// middle of the picture. It is split into readable pieces, each shown for its
// share of the cue's own time.
//
// This listens to the video itself rather than taking a time prop, so a
// timeupdate four times a second re-renders these few lines instead of the
// whole viewer.
export const SubtitleCue = ({
    videoRef, cue, showOrig, showZh, widthPx, fontSize,
    marks, markColor, onWordClick, textStyle
}) => {
    const en = showOrig ? cue.text : '';
    const zh = showZh ? (cue.zh || '') : '';
    const [piece, setPiece] = useState(() => visibleCue({ en, zh, progress: 0, widthPx, fontSize }));

    useEffect(() => {
        const video = videoRef.current;
        const span = Math.max(0.001, cue.end - cue.start);
        const update = () => {
            const now = video ? video.currentTime : cue.start;
            const next = visibleCue({
                en, zh, progress: (now - cue.start) / span, widthPx, fontSize
            });
            // Most timeupdates land inside the same piece; bail out rather
            // than re-rendering four times a second for identical text.
            setPiece(prev => (
                prev.en === next.en && prev.zh === next.zh ? prev : next
            ));
        };
        update();
        if (!video) return undefined;
        video.addEventListener('timeupdate', update);
        return () => video.removeEventListener('timeupdate', update);
    }, [videoRef, cue, en, zh, widthPx, fontSize]);

    return (
        <>
            {piece.en && (
                <div style={{ ...textStyle, fontSize, lineHeight: 1.4, pointerEvents: 'auto' }}>
                    <ClickableText
                        text={piece.en}
                        marks={marksForChunk(marks, cue.text, piece.en)}
                        markColor={markColor}
                        onWordClick={onWordClick}
                    />
                </div>
            )}
            {piece.zh && (
                <div style={{
                    ...textStyle,
                    opacity: piece.en ? 0.78 : 1,
                    fontSize: piece.en ? Math.round(fontSize * 0.78) : fontSize,
                    lineHeight: 1.4,
                    marginTop: piece.en ? 2 : 0
                }}>
                    {piece.zh}
                </div>
            )}
        </>
    );
};
