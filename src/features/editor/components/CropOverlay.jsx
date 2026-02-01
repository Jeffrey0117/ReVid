import { useState, useCallback, useEffect } from 'react';

const HANDLE = 12;
const MIN_SIZE = 20;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function videoToScreen(vc, dr, vd) {
    const sx = dr.width / vd.width;
    const sy = dr.height / vd.height;
    return { x: dr.x + vc.x * sx, y: dr.y + vc.y * sy, width: vc.width * sx, height: vc.height * sy };
}

function screenDeltaToVideo(dx, dy, dr, vd) {
    return { dx: dx * vd.width / dr.width, dy: dy * vd.height / dr.height };
}

export function getDefaultCrop(vw, vh, ar) {
    if (ar) {
        if (ar > vw / vh) {
            const h = vw / ar;
            return { x: 0, y: Math.round((vh - h) / 2), width: vw, height: Math.round(h) };
        }
        const w = vh * ar;
        return { x: Math.round((vw - w) / 2), y: 0, width: Math.round(w), height: vh };
    }
    const m = 0.1;
    return {
        x: Math.round(vw * m), y: Math.round(vh * m),
        width: Math.round(vw * (1 - 2 * m)), height: Math.round(vh * (1 - 2 * m))
    };
}

const EDGES = {
    nw: { l: 1, t: 1 }, n: { t: 1 }, ne: { r: 1, t: 1 },
    w: { l: 1 }, e: { r: 1 },
    sw: { l: 1, b: 1 }, s: { b: 1 }, se: { r: 1, b: 1 }
};

const CURSORS = {
    nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize',
    n: 'ns-resize', s: 'ns-resize', w: 'ew-resize', e: 'ew-resize'
};

export function CropOverlay({ displayRect, videoDimensions, aspectRatio, crop, onCropChange }) {
    const [drag, setDrag] = useState(null);

    const startDrag = useCallback((e, type) => {
        e.preventDefault();
        e.stopPropagation();
        setDrag({ type, sx: e.clientX, sy: e.clientY, start: { ...crop } });
    }, [crop]);

    useEffect(() => {
        if (!drag) return;

        const onMove = (e) => {
            const rawDx = e.clientX - drag.sx;
            const rawDy = e.clientY - drag.sy;
            const { dx, dy } = screenDeltaToVideo(rawDx, rawDy, displayRect, videoDimensions);
            const sc = drag.start;
            const vw = videoDimensions.width;
            const vh = videoDimensions.height;

            if (drag.type === 'move') {
                onCropChange({
                    ...sc,
                    x: clamp(sc.x + dx, 0, vw - sc.width),
                    y: clamp(sc.y + dy, 0, vh - sc.height)
                });
                return;
            }

            const edge = EDGES[drag.type];
            let l = sc.x, t = sc.y, r = sc.x + sc.width, b = sc.y + sc.height;

            if (edge.l) l = clamp(sc.x + dx, 0, r - MIN_SIZE);
            if (edge.r) r = clamp(sc.x + sc.width + dx, l + MIN_SIZE, vw);
            if (edge.t) t = clamp(sc.y + dy, 0, b - MIN_SIZE);
            if (edge.b) b = clamp(sc.y + sc.height + dy, t + MIN_SIZE, vh);

            let w = r - l, h = b - t;

            if (aspectRatio != null) {
                if (w / h > aspectRatio) {
                    w = h * aspectRatio;
                    if (edge.l) l = r - w; else r = l + w;
                } else {
                    h = w / aspectRatio;
                    if (edge.t) t = b - h; else b = t + h;
                }
            }

            onCropChange({ x: l, y: t, width: r - l, height: b - t });
        };

        const onUp = () => setDrag(null);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [drag, displayRect, videoDimensions, aspectRatio, onCropChange]);

    if (!crop || !displayRect) return null;

    const sc = videoToScreen(crop, displayRect, videoDimensions);
    const dims = `${Math.round(crop.width)} \u00d7 ${Math.round(crop.height)}`;

    const corners = [
        { id: 'nw', cx: sc.x, cy: sc.y },
        { id: 'ne', cx: sc.x + sc.width, cy: sc.y },
        { id: 'sw', cx: sc.x, cy: sc.y + sc.height },
        { id: 'se', cx: sc.x + sc.width, cy: sc.y + sc.height },
    ];

    return (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            {/* Crop area with box-shadow mask */}
            <div
                style={{
                    position: 'absolute',
                    left: sc.x, top: sc.y, width: sc.width, height: sc.height,
                    boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                    border: '2px solid rgba(255,255,255,0.85)',
                    boxSizing: 'border-box',
                    pointerEvents: 'auto',
                    cursor: drag?.type === 'move' ? 'grabbing' : 'grab'
                }}
                onMouseDown={(e) => startDrag(e, 'move')}
            >
                {/* Rule-of-thirds grid */}
                {[1, 2].map(i => (
                    <div key={`v${i}`} style={{
                        position: 'absolute', left: `${(i / 3) * 100}%`, top: 0,
                        width: 1, height: '100%', background: 'rgba(255,255,255,0.18)'
                    }} />
                ))}
                {[1, 2].map(i => (
                    <div key={`h${i}`} style={{
                        position: 'absolute', top: `${(i / 3) * 100}%`, left: 0,
                        height: 1, width: '100%', background: 'rgba(255,255,255,0.18)'
                    }} />
                ))}
            </div>

            {/* Corner handles */}
            {corners.map(({ id, cx, cy }) => (
                <div key={id} style={{
                    position: 'absolute',
                    left: cx - HANDLE / 2, top: cy - HANDLE / 2,
                    width: HANDLE, height: HANDLE,
                    background: '#fff', borderRadius: 2,
                    cursor: CURSORS[id],
                    pointerEvents: 'auto',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.5)'
                }} onMouseDown={(e) => startDrag(e, id)} />
            ))}

            {/* Edge handles — horizontal */}
            {['n', 's'].map(id => (
                <div key={id} style={{
                    position: 'absolute',
                    left: sc.x + sc.width / 2 - 16,
                    top: id === 'n' ? sc.y - 3 : sc.y + sc.height - 3,
                    width: 32, height: 6,
                    background: '#fff', borderRadius: 3,
                    cursor: CURSORS[id],
                    pointerEvents: 'auto',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.5)'
                }} onMouseDown={(e) => startDrag(e, id)} />
            ))}

            {/* Edge handles — vertical */}
            {['w', 'e'].map(id => (
                <div key={id} style={{
                    position: 'absolute',
                    top: sc.y + sc.height / 2 - 16,
                    left: id === 'w' ? sc.x - 3 : sc.x + sc.width - 3,
                    height: 32, width: 6,
                    background: '#fff', borderRadius: 3,
                    cursor: CURSORS[id],
                    pointerEvents: 'auto',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.5)'
                }} onMouseDown={(e) => startDrag(e, id)} />
            ))}

            {/* Dimension label */}
            <div style={{
                position: 'absolute',
                left: sc.x + sc.width / 2,
                top: sc.y + sc.height + 10,
                transform: 'translateX(-50%)',
                padding: '3px 10px', borderRadius: 4,
                background: 'rgba(0,0,0,0.75)', color: 'rgba(255,255,255,0.85)',
                fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
                pointerEvents: 'none', letterSpacing: 0.5
            }}>
                {dims}
            </div>
        </div>
    );
}
