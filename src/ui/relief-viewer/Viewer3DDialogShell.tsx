// Viewer3DDialogShell — shared chrome for the ADR-102 3D viewers (relief
// surface, cut preview): backdrop dialog, canvas, loading / ready / failed
// state machine, and scene lifecycle (cancel + dispose on unmount).
// Extracted from Relief3DViewerDialog when the H.11 cut preview became the
// second consumer.

import { useRef } from 'react';
import {
  useViewerDialogScene,
  type ViewerDialogSceneBuilder,
  type ViewerDialogState,
} from './use-viewer-dialog-scene';

export type { ViewerDialogSceneBuilder, ViewerDialogSceneResult } from './use-viewer-dialog-scene';

export const VIEWER_CANVAS_WIDTH_PX = 720;
export const VIEWER_CANVAS_HEIGHT_PX = 480;

export function Viewer3DDialogShell(props: {
  readonly ariaLabel: string;
  readonly canvasAriaLabel: string;
  readonly title: string;
  readonly onClose: () => void;
  // Must be referentially stable (useCallback) — it is the effect dependency.
  // Null means a background preparation task has not produced its mesh yet.
  readonly buildScene: ViewerDialogSceneBuilder | null;
  readonly preparationFailure?: string;
  // A transferred canvas cannot be transferred again. Incrementing this
  // remounts a fresh element when background preparation yields a new mesh.
  readonly canvasKey?: number;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { buildScene } = props;
  const state = useViewerDialogScene(buildScene, canvasRef);

  const visibleState: ViewerDialogState =
    buildScene === null
      ? props.preparationFailure === undefined
        ? { kind: 'loading' }
        : { kind: 'failed', reason: props.preparationFailure }
      : state.buildScene === buildScene
        ? state.value
        : { kind: 'loading' };

  return (
    <div role="dialog" aria-label={props.ariaLabel} style={backdropStyle}>
      <div style={panelStyle}>
        <div style={headerStyle}>
          <h3 style={titleStyle}>{props.title}</h3>
          <button type="button" onClick={props.onClose} title="Close the 3D viewer">
            Close
          </button>
        </div>
        <canvas
          key={props.canvasKey}
          ref={canvasRef}
          width={VIEWER_CANVAS_WIDTH_PX}
          height={VIEWER_CANVAS_HEIGHT_PX}
          aria-label={props.canvasAriaLabel}
          style={canvasStyle}
        />
        {visibleState.kind === 'loading' ? <p style={hintStyle}>Building the 3D surface…</p> : null}
        {visibleState.kind === 'failed' ? (
          <p style={hintStyle} role="alert">
            3D view unavailable: {visibleState.reason}
          </p>
        ) : null}
        {visibleState.kind === 'ready' ? (
          <p style={hintStyle}>Drag to orbit, scroll to zoom. Depth is true to scale.</p>
        ) : null}
      </div>
    </div>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'var(--lf-backdrop)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 40,
};
const panelStyle: React.CSSProperties = {
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-text)',
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 12,
  maxWidth: 'calc(100vw - 48px)',
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 8,
};
const titleStyle: React.CSSProperties = {
  fontSize: 13,
  margin: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const canvasStyle: React.CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  borderRadius: 4,
};
const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '8px 0 0 0',
};
