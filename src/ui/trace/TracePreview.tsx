// TracePreview renders the Trace Image preview frame. It shows the
// traced SVG over the source bitmap, plus preview-only LightBurn-style
// toggles for fading the source and showing vector points.

import { useState } from 'react';

import type { TracePreviewState } from './use-trace-preview';

type Props = {
  readonly state: TracePreviewState;
  readonly sourceDataUrl?: string;
};

export function TracePreview(props: Props): JSX.Element {
  const { state } = props;
  const [isSourceFaded, setIsSourceFaded] = useState(false);
  const [shouldShowPoints, setShouldShowPoints] = useState(false);
  const hasSource = props.sourceDataUrl !== undefined && props.sourceDataUrl.length > 0;
  const canShowPoints = state.kind === 'ready';
  return (
    <div style={stackStyle}>
      {hasSource || canShowPoints ? (
        <div style={buttonRowStyle}>
          {hasSource ? (
            <button
              type="button"
              aria-pressed={isSourceFaded}
              onClick={() => setIsSourceFaded((next) => !next)}
              style={previewButtonStyle}
            >
              Fade Image
            </button>
          ) : null}
          {canShowPoints ? (
            <button
              type="button"
              aria-pressed={shouldShowPoints}
              onClick={() => setShouldShowPoints((next) => !next)}
              style={previewButtonStyle}
            >
              Show Points
            </button>
          ) : null}
        </div>
      ) : null}
      <div style={frameStyle} aria-label="Trace preview">
        {hasSource ? (
          <img
            src={props.sourceDataUrl}
            alt=""
            aria-label="Trace source image"
            style={sourceImageStyle(isSourceFaded)}
          />
        ) : null}
        <Inner state={state} shouldShowPoints={shouldShowPoints} />
      </div>
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
            // SVG comes from the trusted local trace path and is
            // sanitized before reaching this component.
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

const SOURCE_NORMAL_OPACITY = 1;
const SOURCE_FADED_OPACITY = 0.2;
const POINT_RADIUS_PX = 1.6;
const POINT_STROKE_WIDTH_PX = 0.45;
const POINT_FILL_COLOR = '#7c3aed';
const POINT_STROKE_COLOR = '#ffffff';

const stackStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
};

const previewButtonStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  background: 'transparent',
  border: '1px solid #ccc',
  borderRadius: 3,
  cursor: 'pointer',
};

const frameStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: 240,
  background: '#fafafa',
  border: '1px solid #ddd',
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
  color: '#888',
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
