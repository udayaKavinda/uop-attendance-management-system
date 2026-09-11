import { useEffect, useRef, useState } from 'react';
import campusMap from '../assets/campus-map.png';

const MIN_SCALE = 1;
const MAX_SCALE = 4;

/** Distance between the two touches of a pinch gesture. */
function touchDistance(touches: TouchList): number {
  const [a, b] = [touches[0], touches[1]];
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

/**
 * Faculty building-key map, shown from the "Where is this lecture?" hint so staff
 * can look up which numbered building a geofence corresponds to. Zoom/pan is a
 * hand-rolled transform rather than native pinch-zoom, since the image sits inside
 * a scrolling dialog rather than its own page.
 */
export function MapDialog({ onDismiss }: { onDismiss: () => void }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const pinch = useRef<{ distance: number; scale: number } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  function clampScale(next: number) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  }

  function zoomBy(factor: number) {
    setScale((s) => {
      const next = clampScale(s * factor);
      if (next === MIN_SCALE) setPos({ x: 0, y: 0 });
      return next;
    });
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2);
  }

  function onDoubleClick() {
    setScale((s) => (s > MIN_SCALE ? MIN_SCALE : 2.5));
    setPos({ x: 0, y: 0 });
  }

  function onMouseDown(e: React.MouseEvent) {
    if (scale === MIN_SCALE) return;
    drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!drag.current) return;
    setPos({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
  }

  function endDrag() {
    drag.current = null;
  }

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      pinch.current = { distance: touchDistance(e.touches), scale };
    } else if (e.touches.length === 1 && scale > MIN_SCALE) {
      const t = e.touches[0];
      drag.current = { x: t.clientX - pos.x, y: t.clientY - pos.y };
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinch.current) {
      const ratio = touchDistance(e.touches) / pinch.current.distance;
      setScale(clampScale(pinch.current.scale * ratio));
    } else if (e.touches.length === 1 && drag.current) {
      const t = e.touches[0];
      setPos({ x: t.clientX - drag.current.x, y: t.clientY - drag.current.y });
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) pinch.current = null;
    if (e.touches.length === 0) drag.current = null;
  }

  return (
    <div
      className="dialog__scrim map-dialog__scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Campus building map"
      onClick={onDismiss}
    >
      <div className="map-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="map-dialog__head">
          <span className="dialog__title">Building map</span>
          <button
            type="button"
            className="map-dialog__close"
            onClick={onDismiss}
            aria-label="Close map"
          >
            ✕
          </button>
        </div>

        <div
          className="map-dialog__viewport"
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <img
            src={campusMap}
            alt="Numbered map of the Faculty of Engineering buildings"
            className="map-dialog__image"
            draggable={false}
            style={{
              transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px)) scale(${scale})`,
              cursor: scale > MIN_SCALE ? 'grab' : 'zoom-in',
            }}
          />
        </div>

        <div className="map-dialog__controls">
          <button type="button" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">
            −
          </button>
          <span className="map-dialog__scale">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => zoomBy(1.4)} aria-label="Zoom in">
            +
          </button>
        </div>
      </div>
    </div>
  );
}
