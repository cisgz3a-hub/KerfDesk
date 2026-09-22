// Hover an object, see how big it is (ADR-348). Size used to be readable only
// once artwork was selected — from the numeric bar, or by dragging a handle
// and watching the drag chip. Hovering answers "how wide is that one?" without
// touching the scene at all.
//
// Hit-testing runs on a short dwell, NOT on every pointer move: a hit inside a
// large vector flattens its curves (100k segment budget), which is far too
// much work to repeat at mouse-move cadence over a dense trace. The dwell is
// also the conventional tooltip feel — you have to mean it.

import { useEffect, useState } from 'react';
import {
  artworkOperationName,
  hitTest,
  transformedBBox,
  type Project,
  type Vec2,
} from '../../core/scene';
import { useStore } from '../state';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';
import { computeView, type ViewState } from './view-transform';

const DWELL_MS = 140;

export function HoverSizeReadout(props: {
  readonly project: Project;
  readonly canvasSize: CanvasBitmapSize;
  readonly viewState: ViewState;
  /** Suppressed mid-gesture: a drag has its own readout, and it owns the pointer. */
  readonly enabled: boolean;
}): JSX.Element | null {
  const cursor = useStore((state) => state.cursorMm);
  const hovered = useDwellHit(props.enabled ? cursor : null, props.project);
  if (hovered === null) return null;
  const object = props.project.scene.objects.find((candidate) => candidate.id === hovered.id);
  if (object === undefined) return null;
  const bbox = transformedBBox(object);
  const view = computeView(
    props.canvasSize.width,
    props.canvasSize.height,
    props.project.device.bedWidth,
    props.project.device.bedHeight,
    props.viewState,
  );
  const left = view.offsetX + hovered.point.x * view.scale + 14;
  const top = view.offsetY + hovered.point.y * view.scale + 16;
  return (
    // aria-hidden like the drag readout: this fires on every hover, and a live
    // region that chatty is worse than silence. The same numbers are on the
    // status bar and in the numeric bar once the artwork is selected.
    <div className="lf-chip" style={{ ...readoutStyle, left, top }} aria-hidden="true">
      <strong style={nameStyle}>{artworkOperationName(object)}</strong>
      <span style={sizeStyle}>
        {formatMm(bbox.maxX - bbox.minX)} × {formatMm(bbox.maxY - bbox.minY)} mm
      </span>
      <span style={positionStyle}>
        X {formatMm(bbox.minX)}, Y {formatMm(bbox.minY)}
      </span>
    </div>
  );
}

type Hover = { readonly id: string; readonly point: Vec2 };

/** Null while the pointer is still moving; the hit once it has settled. */
function useDwellHit(cursor: Vec2 | null, project: Project): Hover | null {
  const [hover, setHover] = useState<Hover | null>(null);
  const x = cursor?.x ?? null;
  const y = cursor?.y ?? null;
  useEffect(() => {
    setHover(null);
    if (x === null || y === null) return;
    const point = { x, y };
    const timer = setTimeout(() => {
      const id = hitTest(project.scene, point);
      setHover(id === null ? null : { id, point });
    }, DWELL_MS);
    return () => clearTimeout(timer);
  }, [x, y, project.scene]);
  return hover;
}

// Whole millimetres read as clutter-free at a glance; one decimal keeps a
// 0.5 mm kerf test from rounding to nothing.
function formatMm(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}

const readoutStyle: React.CSSProperties = {
  position: 'absolute',
  zIndex: 6,
  display: 'grid',
  gap: 1,
  maxWidth: 220,
  padding: '5px 8px',
  boxShadow: 'var(--lf-shadow)',
  pointerEvents: 'none',
  fontFamily: 'system-ui, sans-serif',
  lineHeight: 1.35,
};

const nameStyle: React.CSSProperties = {
  overflow: 'hidden',
  fontSize: 'var(--lf-text-sm)',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const sizeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 'var(--lf-text-sm)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const positionStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 'var(--lf-text-xs)',
  whiteSpace: 'nowrap',
};
