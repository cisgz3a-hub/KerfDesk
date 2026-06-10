// TracePreview renders the Trace Image preview frame. It shows the
// traced SVG over the source bitmap, plus preview-only LightBurn-style
// toggles for fading the source and showing vector points.

import { useRef, useState } from 'react';

import { normalizeTraceBoundary, type TraceBoundary } from '../../core/trace';
import type { TracePreviewState } from './use-trace-preview';

type Props = {
  readonly state: TracePreviewState;
  readonly sourceDataUrl?: string;
  readonly imageSize?: { readonly width: number; readonly height: number };
  readonly boundary?: TraceBoundary | null;
  readonly onBoundaryChange?: (boundary: TraceBoundary) => void;
  readonly onBoundaryClear?: () => void;
};

type DragPoint = { readonly x: number; readonly y: number };
type DragRef = { current: DragPoint | null };

export function TracePreview(props: Props): JSX.Element {
  const { state } = props;
  const [isSourceFaded, setIsSourceFaded] = useState(false);
  const [shouldShowPoints, setShouldShowPoints] = useState(false);
  const hasSource = props.sourceDataUrl !== undefined && props.sourceDataUrl.length > 0;
  const canShowPoints = state.kind === 'ready';
  return (
    <div style={stackStyle}>
      <PreviewControls
        hasSource={hasSource}
        canShowPoints={canShowPoints}
        boundary={props.boundary ?? null}
        isSourceFaded={isSourceFaded}
        shouldShowPoints={shouldShowPoints}
        onToggleFade={() => setIsSourceFaded((next) => !next)}
        onTogglePoints={() => setShouldShowPoints((next) => !next)}
        onBoundaryClear={props.onBoundaryClear}
      />
      <PreviewFrame
        {...props}
        hasSource={hasSource}
        isSourceFaded={isSourceFaded}
        shouldShowPoints={shouldShowPoints}
      />
    </div>
  );
}

function PreviewControls(props: {
  readonly hasSource: boolean;
  readonly canShowPoints: boolean;
  readonly boundary: TraceBoundary | null;
  readonly isSourceFaded: boolean;
  readonly shouldShowPoints: boolean;
  readonly onToggleFade: () => void;
  readonly onTogglePoints: () => void;
  readonly onBoundaryClear: (() => void) | undefined;
}): JSX.Element | null {
  if (!props.hasSource && !props.canShowPoints && props.boundary === null) return null;
  return (
    <div style={buttonRowStyle}>
      {props.hasSource ? (
        <button
          type="button"
          aria-pressed={props.isSourceFaded}
          onClick={props.onToggleFade}
          className="lf-btn"
          style={previewButtonSizeStyle}
        >
          Fade Image
        </button>
      ) : null}
      {props.canShowPoints ? (
        <button
          type="button"
          aria-pressed={props.shouldShowPoints}
          onClick={props.onTogglePoints}
          className="lf-btn"
          style={previewButtonSizeStyle}
        >
          Show Points
        </button>
      ) : null}
      {props.boundary !== null ? (
        <button
          type="button"
          onClick={props.onBoundaryClear}
          className="lf-btn"
          style={previewButtonSizeStyle}
        >
          Clear Boundary
        </button>
      ) : null}
    </div>
  );
}

function PreviewFrame(
  props: Props & {
    readonly hasSource: boolean;
    readonly isSourceFaded: boolean;
    readonly shouldShowPoints: boolean;
  },
): JSX.Element {
  const dragStartRef = useRef<DragPoint | null>(null);
  const [draftBoundary, setDraftBoundary] = useState<TraceBoundary | null>(null);
  const activeBoundary = draftBoundary ?? props.boundary ?? null;
  return (
    <div
      style={frameStyle}
      aria-label="Trace preview"
      onMouseDown={(e) => startBoundaryDrag(e, props, dragStartRef, setDraftBoundary)}
      onMouseMove={(e) => updateBoundaryDrag(e, props, dragStartRef, setDraftBoundary)}
      onMouseUp={(e) => finishBoundaryDrag(e, props, dragStartRef, setDraftBoundary)}
    >
      {props.hasSource ? (
        <img
          src={props.sourceDataUrl}
          alt=""
          aria-label="Trace source image"
          style={sourceImageStyle(props.isSourceFaded)}
        />
      ) : null}
      <Inner state={props.state} shouldShowPoints={props.shouldShowPoints} />
      {activeBoundary !== null && props.imageSize !== undefined ? (
        <BoundaryOverlay boundary={activeBoundary} imageSize={props.imageSize} />
      ) : null}
    </div>
  );
}

function Inner(props: {
  readonly state: TracePreviewState;
  readonly shouldShowPoints: boolean;
}): JSX.Element {
  const { state } = props;
  switch (state.kind) {
    case 'idle':
      return <span style={hintStyle}>Pick an image to preview the trace.</span>;
    case 'decoding':
      return <span style={hintStyle}>Decoding image...</span>;
    case 'tracing':
      return <span style={hintStyle}>Tracing...</span>;
    case 'error':
      return <span style={errorStyle}>Preview failed: {state.message}</span>;
    case 'ready':
      return (
        <>
          <div
            style={svgWrapStyle}
            // Safe WITHOUT sanitization (LU9): state.svg is built locally by
            // coloredPathsToSvg — a pure stringifier interpolating rounded
            // numbers and hex colors only. No user-controlled markup can
            // reach this string. If a future change routes imported markup
            // here, it MUST go through sanitizeSvg first.
            dangerouslySetInnerHTML={{ __html: state.svg }}
            aria-label={`Trace preview (${state.width}x${state.height} px)`}
          />
          {props.shouldShowPoints ? <TracePointsOverlay state={state} /> : null}
        </>
      );
  }
}

function TracePointsOverlay(props: {
  readonly state: Extract<TracePreviewState, { readonly kind: 'ready' }>;
}): JSX.Element {
  const { state } = props;
  const points = state.paths.flatMap((path) =>
    path.polylines.flatMap((polyline) => polyline.points),
  );
  return (
    <svg
      aria-label="Trace points"
      style={pointsOverlayStyle}
      viewBox={`0 0 ${state.width} ${state.height}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
    >
      {points.map((point, index) => (
        <circle
          key={`${index}:${point.x}:${point.y}`}
          cx={point.x}
          cy={point.y}
          r={POINT_RADIUS_PX}
          fill={POINT_FILL_COLOR}
          stroke={POINT_STROKE_COLOR}
          strokeWidth={POINT_STROKE_WIDTH_PX}
        />
      ))}
    </svg>
  );
}

function BoundaryOverlay(props: {
  readonly boundary: TraceBoundary;
  readonly imageSize: { readonly width: number; readonly height: number };
}): JSX.Element {
  return (
    <svg
      aria-label="Trace boundary"
      style={boundaryOverlayStyle}
      viewBox={`0 0 ${props.imageSize.width} ${props.imageSize.height}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect
        x={props.boundary.x}
        y={props.boundary.y}
        width={props.boundary.width}
        height={props.boundary.height}
        fill={BOUNDARY_FILL}
        stroke={BOUNDARY_STROKE}
        strokeWidth={BOUNDARY_STROKE_WIDTH_PX}
      />
    </svg>
  );
}

function startBoundaryDrag(
  e: React.MouseEvent<HTMLDivElement>,
  props: Props,
  dragStartRef: DragRef,
  setDraftBoundary: (boundary: TraceBoundary | null) => void,
): void {
  if (e.button !== 0 || props.imageSize === undefined) return;
  const point = imagePointFromMouse(e, props.imageSize);
  dragStartRef.current = point;
  setDraftBoundary({ x: point.x, y: point.y, width: 0, height: 0 });
  e.preventDefault();
}

function updateBoundaryDrag(
  e: React.MouseEvent<HTMLDivElement>,
  props: Props,
  dragStartRef: DragRef,
  setDraftBoundary: (boundary: TraceBoundary | null) => void,
): void {
  const dragStart = dragStartRef.current;
  if (dragStart === null || props.imageSize === undefined) return;
  const point = imagePointFromMouse(e, props.imageSize);
  setDraftBoundary(boundaryFromPoints(dragStart, point));
}

function finishBoundaryDrag(
  e: React.MouseEvent<HTMLDivElement>,
  props: Props,
  dragStartRef: DragRef,
  setDraftBoundary: (boundary: TraceBoundary | null) => void,
): void {
  const dragStart = dragStartRef.current;
  if (dragStart === null || props.imageSize === undefined || props.onBoundaryChange === undefined) {
    return;
  }
  const point = imagePointFromMouse(e, props.imageSize);
  const boundary = normalizeTraceBoundary(
    boundaryFromPoints(dragStart, point),
    props.imageSize.width,
    props.imageSize.height,
  );
  dragStartRef.current = null;
  setDraftBoundary(null);
  if (boundary !== null) props.onBoundaryChange(boundary);
}

function boundaryFromPoints(a: DragPoint, b: DragPoint): TraceBoundary {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function imagePointFromMouse(
  e: React.MouseEvent<HTMLDivElement>,
  imageSize: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } {
  const rect = e.currentTarget.getBoundingClientRect();
  const scale = Math.min(rect.width / imageSize.width, rect.height / imageSize.height);
  const drawnWidth = imageSize.width * scale;
  const drawnHeight = imageSize.height * scale;
  const left = rect.left + (rect.width - drawnWidth) / 2;
  const top = rect.top + (rect.height - drawnHeight) / 2;
  return {
    x: clamp((e.clientX - left) / scale, 0, imageSize.width),
    y: clamp((e.clientY - top) / scale, 0, imageSize.height),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const SOURCE_NORMAL_OPACITY = 1;
const SOURCE_FADED_OPACITY = 0.2;
const POINT_RADIUS_PX = 1.6;
const POINT_STROKE_WIDTH_PX = 0.45;
const POINT_FILL_COLOR = '#7c3aed';
const POINT_STROKE_COLOR = '#ffffff';
const BOUNDARY_FILL = 'rgba(124, 58, 237, 0.08)';
const BOUNDARY_STROKE = '#7c3aed';
const BOUNDARY_STROKE_WIDTH_PX = 1.2;

const stackStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
};

// Size-only override on .lf-btn — these are compact preview toggles.
const previewButtonSizeStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
};

const frameStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: 240,
  background: '#fafafa',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  overflow: 'hidden',
};

function sourceImageStyle(isFaded: boolean): React.CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    opacity: isFaded ? SOURCE_FADED_OPACITY : SOURCE_NORMAL_OPACITY,
    pointerEvents: 'none',
  };
}

const hintStyle: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  fontSize: 12,
  // Dark-on-light, NOT the theme text vars: this text sits inside the
  // always-light preview frame (artwork previews stay light, ADR-047).
  color: '#666',
  fontStyle: 'italic',
};

const errorStyle: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  fontSize: 12,
  color: '#b00020',
  padding: 8,
  textAlign: 'center',
};

const svgWrapStyle: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const pointsOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  zIndex: 2,
  pointerEvents: 'none',
};

const boundaryOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  zIndex: 3,
  pointerEvents: 'none',
};
