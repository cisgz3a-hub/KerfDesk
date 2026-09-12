// Comparison, magnification and overlays are local viewing state. They never
// change trace options or rebuild the generated trace geometry.
/* eslint-disable no-restricted-syntax -- the artwork surface and its purple
   trace markers deliberately stay light/material-facing (ADR-047). */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { TraceBoundary } from '../../core/trace';
import type { TracePreviewState } from './use-trace-preview';
import { traceNoticeMessage } from './trace-notices';
import { useTracePreviewBoundary, type TracePreviewBoundaryProps } from './trace-preview-boundary';
import { TracePreviewControls, type TracePreviewView } from './trace-preview-controls';
import { useTracePreviewZoom } from './trace-preview-zoom';
import { useTracePreviewImageSpace } from './trace-preview-image-space';
import './trace-preview.css';

type Props = TracePreviewBoundaryProps & {
  readonly state: TracePreviewState;
  readonly sourceDataUrl?: string;
  readonly onBoundaryClear?: () => void;
};

type ReadyPreview = Extract<TracePreviewState, { readonly kind: 'ready' }>;

export function TracePreview(props: Props): JSX.Element {
  const { state } = props;
  const [selectedView, setSelectedView] = useState<TracePreviewView>('overlay');
  const [isSourceFaded, setIsSourceFaded] = useState(true);
  const [shouldShowPoints, setShouldShowPoints] = useState(false);
  const { zoom, viewportRef, zoomTo } = useTracePreviewZoom();
  const hasSource = props.sourceDataUrl !== undefined && props.sourceDataUrl.length > 0;
  const view = hasSource ? selectedView : 'trace';
  const isLoading = state.kind === 'decoding' || state.kind === 'tracing';
  return (
    <div className="lf-trace-preview">
      <TracePreviewControls
        view={view}
        hasSource={hasSource}
        hasTrace={state.kind === 'ready'}
        zoom={zoom}
        hasBoundary={props.boundary !== undefined && props.boundary !== null}
        isSourceFaded={isSourceFaded}
        shouldShowPoints={shouldShowPoints}
        onViewChange={setSelectedView}
        onZoomChange={zoomTo}
        onToggleFade={() => setIsSourceFaded((next) => !next)}
        onTogglePoints={() => setShouldShowPoints((next) => !next)}
        onBoundaryClear={props.onBoundaryClear}
      />
      <div className="lf-trace-preview__surface">
        <div
          ref={viewportRef}
          className="lf-trace-preview__viewport"
          role="region"
          aria-label="Preview viewport"
          aria-busy={isLoading}
          tabIndex={0}
          title="Use the scrollbars, trackpad or arrow keys to move around a zoomed preview."
        >
          <PreviewFrame
            {...props}
            zoom={zoom}
            view={view}
            hasSource={hasSource}
            isSourceFaded={isSourceFaded}
            shouldShowPoints={shouldShowPoints}
          />
        </div>
        {isLoading ? <PreviewLoading isDecoding={state.kind === 'decoding'} /> : null}
      </div>
      <PreviewStatus state={state} />
      <p className="lf-trace-preview__help">
        {props.onBoundaryChange !== undefined ? 'Drag on the image to select a boundary. ' : ''}
        Scroll to pan when zoomed.
      </p>
      {state.kind === 'ready'
        ? state.notices?.map((notice) => (
            <p key={notice} role="status" className="lf-trace-preview__notice">
              {traceNoticeMessage(notice)}
            </p>
          ))
        : null}
    </div>
  );
}

function PreviewFrame(
  props: Props & {
    readonly zoom: number;
    readonly view: TracePreviewView;
    readonly hasSource: boolean;
    readonly isSourceFaded: boolean;
    readonly shouldShowPoints: boolean;
  },
): JSX.Element {
  const { activeBoundary, ...dragHandlers } = useTracePreviewBoundary(props);
  const imageSize = props.imageSize ?? (props.state.kind === 'ready' ? props.state : undefined);
  const { stageRef, rectangle } = useTracePreviewImageSpace(imageSize, props.zoom);
  return (
    <div
      ref={stageRef}
      className="lf-trace-preview__stage"
      data-view={props.view}
      style={{ width: `${props.zoom * 100}%`, height: `${props.zoom * 100}%` }}
      aria-label="Trace preview"
      {...dragHandlers}
    >
      <div
        className="lf-trace-preview__artwork"
        style={rectangle ?? fullStageStyle}
        data-natural-fit={imageSize === undefined}
      >
        {props.hasSource ? (
          <img
            src={props.sourceDataUrl}
            alt=""
            aria-label="Trace source image"
            className="lf-trace-preview__source"
            hidden={props.view === 'trace'}
            draggable={false}
            style={{ opacity: props.isSourceFaded && props.view === 'overlay' ? 0.2 : 1 }}
          />
        ) : null}
        {props.state.kind === 'ready' ? (
          <TraceArtwork
            state={props.state}
            hidden={props.view === 'original'}
            shouldShowPoints={props.shouldShowPoints}
          />
        ) : null}
        {activeBoundary !== null && props.imageSize !== undefined ? (
          <BoundaryOverlay boundary={activeBoundary} imageSize={props.imageSize} />
        ) : null}
      </div>
    </div>
  );
}

function PreviewLoading({ isDecoding }: { readonly isDecoding: boolean }): JSX.Element {
  return (
    <div className="lf-trace-preview__loading">
      <div
        className="lf-trace-preview__loading-card"
        role="progressbar"
        aria-label={isDecoding ? 'Preparing image for tracing' : 'Tracing image'}
      >
        <span className="lf-trace-preview__spinner" aria-hidden="true" />
        <strong>{isDecoding ? 'Preparing image' : 'Tracing image'}</strong>
        <p>
          {isDecoding
            ? 'Reading the image before tracing begins.'
            : 'Finding and refining the trace. Detailed images can take a moment.'}
        </p>
      </div>
    </div>
  );
}

function TraceArtwork(props: {
  readonly state: ReadyPreview;
  readonly hidden: boolean;
  readonly shouldShowPoints: boolean;
}): JSX.Element {
  const { state } = props;
  const vectorsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Change only the preview root's grid mapping, once per new SVG. Avoid
    // copying or parsing a dense path string again on view/zoom changes.
    vectorsRef.current?.firstElementChild?.setAttribute('preserveAspectRatio', 'none');
  }, [state.svg]);
  return (
    <div className="lf-trace-preview__trace" hidden={props.hidden}>
      <div
        ref={vectorsRef}
        className="lf-trace-preview__vectors"
        // Safe WITHOUT sanitization (LU9): state.svg is built locally by
        // coloredPathsToSvg from numbers and hex colors. Imported markup must
        // never reach this string without first passing through sanitizeSvg.
        dangerouslySetInnerHTML={{ __html: state.svg }}
        aria-label={`Trace preview (${state.width}x${state.height} px)`}
      />
      {props.shouldShowPoints ? <TracePointsOverlay state={state} /> : null}
    </div>
  );
}

function PreviewStatus({ state }: { readonly state: TracePreviewState }): JSX.Element {
  const paths = state.kind === 'ready' ? state.paths : undefined;
  const counts = useMemo(() => countPreviewGeometry(paths), [paths]);
  return (
    <div
      className="lf-trace-preview__status"
      data-state={state.kind}
      role={state.kind === 'error' ? 'alert' : 'status'}
      aria-live={state.kind === 'error' ? undefined : 'polite'}
      aria-atomic="true"
    >
      {state.kind === 'ready' ? (
        <>
          <span>
            {counts.paths === 0
              ? 'No trace paths found.'
              : `Trace ready · ${countLabel(counts.paths, 'path')}`}
            {' · '}
            {countLabel(counts.points, 'point')}
          </span>
          <span className="lf-trace-preview__dimensions">
            {state.width} × {state.height} px
          </span>
        </>
      ) : (
        <span>{previewPhaseMessage(state)}</span>
      )}
    </div>
  );
}

function countPreviewGeometry(paths: ReadyPreview['paths'] | undefined): {
  readonly paths: number;
  readonly points: number;
} {
  let pathCount = 0;
  let pointCount = 0;
  for (const path of paths ?? []) {
    pathCount += path.polylines.length;
    for (const polyline of path.polylines) pointCount += polyline.points.length;
  }
  return { paths: pathCount, points: pointCount };
}

function countLabel(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}

function previewPhaseMessage(state: Exclude<TracePreviewState, ReadyPreview>): string {
  switch (state.kind) {
    case 'idle':
      return 'Preview is waiting for an image.';
    case 'decoding':
      return 'Decoding image...';
    case 'tracing':
      return 'Tracing...';
    case 'error':
      return `Preview failed: ${state.message}`;
  }
}

function TracePointsOverlay({ state }: { readonly state: ReadyPreview }): JSX.Element {
  // Keep all requested points, and cache the JSX by paths identity. View,
  // magnification and boundary drags must not rebuild a dense point overlay.
  const circles = useMemo(
    () =>
      state.paths
        .flatMap((path) => path.polylines.flatMap((polyline) => polyline.points))
        .map((point, index) => (
          <circle
            key={`${index}:${point.x}:${point.y}`}
            cx={point.x}
            cy={point.y}
            r={1.6}
            fill="#7c3aed"
            stroke="#ffffff"
            strokeWidth={0.45}
          />
        )),
    [state.paths],
  );
  return (
    <svg
      aria-label="Trace points"
      className="lf-trace-preview__points"
      viewBox={`0 0 ${state.width} ${state.height}`}
      width="100%"
      height="100%"
      preserveAspectRatio="none"
    >
      {circles}
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
      className="lf-trace-preview__boundary"
      viewBox={`0 0 ${props.imageSize.width} ${props.imageSize.height}`}
      width="100%"
      height="100%"
      preserveAspectRatio="none"
    >
      <rect
        x={props.boundary.x}
        y={props.boundary.y}
        width={props.boundary.width}
        height={props.boundary.height}
        fill="rgba(124, 58, 237, 0.08)"
        stroke="#7c3aed"
        strokeWidth={1.2}
      />
    </svg>
  );
}

const fullStageStyle: React.CSSProperties = { left: 0, top: 0, width: '100%', height: '100%' };
