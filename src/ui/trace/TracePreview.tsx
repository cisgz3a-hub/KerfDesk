// Comparison, magnification and overlays are local viewing state. They never
// change trace options or rebuild the generated trace geometry.
/* eslint-disable no-restricted-syntax -- the artwork surface and its purple
   trace markers deliberately stay light/material-facing (ADR-047). */

import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { TraceBoundary } from '../../core/trace';
import type { TracePreviewState } from './use-trace-preview';
import { traceNoticeMessage } from './trace-notices';
import { useTracePreviewBoundary, type TracePreviewBoundaryProps } from './trace-preview-boundary';
import { TracePreviewControls, type TracePreviewView } from './trace-preview-controls';
import { useTracePreviewZoom } from './trace-preview-zoom';
import { useTracePreviewNavigation } from './trace-preview-navigation';
import { useTracePreviewImageSpace } from './trace-preview-image-space';
import { TracePointsOverlay } from './TracePointsOverlay';
import { TracePreviewLoading } from './TracePreviewLoading';
import './trace-preview.css';

type Props = TracePreviewBoundaryProps & {
  readonly state: TracePreviewState;
  readonly sourceDataUrl?: string;
  readonly isRasterizing?: boolean;
  readonly onBoundaryClear?: () => void;
};

type ReadyPreview = Extract<TracePreviewState, { readonly kind: 'ready' }>;

export function TracePreview(props: Props): JSX.Element {
  const { state } = props;
  const [selectedView, setSelectedView] = useState<TracePreviewView>('overlay');
  const [isSourceFaded, setIsSourceFaded] = useState(true);
  const [shouldShowPoints, setShouldShowPoints] = useState(false);
  const view = useTracePreviewZoom(previewImageSize(props));
  const { zoom, viewportRef } = view;
  const { panState, isPanGesture } = useTracePreviewNavigation(view);
  const helpId = useId();
  const hasSource = props.sourceDataUrl !== undefined && props.sourceDataUrl.length > 0;
  const comparison = hasSource ? selectedView : 'trace';
  const isLoading = isPreviewLoading(state, props.isRasterizing);
  return (
    <div className="lf-trace-preview">
      <TracePreviewControls
        view={comparison}
        hasSource={hasSource}
        hasTrace={state.kind === 'ready'}
        zoom={zoom}
        zoomRange={view.range}
        hasBoundary={props.boundary !== undefined && props.boundary !== null}
        isSourceFaded={isSourceFaded}
        shouldShowPoints={shouldShowPoints}
        onViewChange={setSelectedView}
        onZoomChange={(value) => view.zoomTo(value)}
        onToggleFade={() => setIsSourceFaded((next) => !next)}
        onTogglePoints={() => setShouldShowPoints((next) => !next)}
        onBoundaryClear={props.onBoundaryClear}
        boundaryDisabled={props.boundaryDisabled === true}
      />
      <div className="lf-trace-preview__surface">
        <div
          ref={viewportRef}
          className="lf-trace-preview__viewport"
          role="region"
          aria-label="Preview viewport"
          aria-busy={isLoading}
          aria-describedby={helpId}
          data-pan={panState}
          tabIndex={0}
        >
          <PreviewFrame
            {...props}
            zoom={zoom}
            lensRef={view.lensRef}
            view={comparison}
            isPanGesture={isPanGesture}
            hasSource={hasSource}
            isSourceFaded={isSourceFaded}
            shouldShowPoints={shouldShowPoints}
          />
        </div>
        {isLoading ? (
          <TracePreviewLoading
            isDecoding={state.kind === 'decoding'}
            isRasterizing={props.isRasterizing}
            phase={state.kind === 'tracing' ? state.phase : undefined}
            startedAt={
              state.kind === 'decoding' || state.kind === 'tracing' ? state.startedAt : undefined
            }
          />
        ) : null}
      </div>
      <PreviewStatus state={state} />
      <p id={helpId} className="lf-trace-preview__help">
        {props.onBoundaryChange !== undefined ? 'Drag on the image to select a boundary. ' : ''}
        Wheel or pinch to zoom; middle-drag, Space+drag or two fingers to pan. Keys: + − zoom, 0
        Fit, 1 actual size, arrows pan.
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

// The original image's domain when known, else the trace grid's.
function previewImageSize(
  props: Props,
): { readonly width: number; readonly height: number } | undefined {
  return props.imageSize ?? (props.state.kind === 'ready' ? props.state : undefined);
}

function isPreviewLoading(state: TracePreviewState, isRasterizing?: boolean): boolean {
  return state.kind === 'decoding' || state.kind === 'tracing' || isRasterizing === true;
}

function PreviewFrame(
  props: Props & {
    readonly zoom: number;
    readonly lensRef: React.RefObject<HTMLDivElement>;
    readonly view: TracePreviewView;
    readonly hasSource: boolean;
    readonly isSourceFaded: boolean;
    readonly shouldShowPoints: boolean;
    readonly isPanGesture: () => boolean;
  },
): JSX.Element {
  const { activeBoundary, ...dragHandlers } = useTracePreviewBoundary(props, props.isPanGesture);
  const imageSize = previewImageSize(props);
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
        ref={props.lensRef}
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
      {props.shouldShowPoints ? (
        <TracePointsOverlay paths={state.paths} width={state.width} height={state.height} />
      ) : null}
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
