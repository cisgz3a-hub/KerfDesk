// Viewer3DDialogShell — shared chrome for the ADR-102 3D viewers (relief
// surface, cut preview): backdrop dialog, canvas, loading / ready / failed
// state machine, and scene lifecycle (cancel + dispose on unmount).
// Extracted from Relief3DViewerDialog when the H.11 cut preview became the
// second consumer.

import { useEffect, useRef, useState } from 'react';
import type { ReliefSceneResult } from './relief-three-scene';

export const VIEWER_CANVAS_WIDTH_PX = 720;
export const VIEWER_CANVAS_HEIGHT_PX = 480;

type ViewerState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly reason: string };

export function Viewer3DDialogShell(props: {
  readonly ariaLabel: string;
  readonly canvasAriaLabel: string;
  readonly title: string;
  readonly onClose: () => void;
  // Must be referentially stable (useCallback) — it is the effect dependency.
  readonly buildScene: (canvas: HTMLCanvasElement) => Promise<ReliefSceneResult>;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<ViewerState>({ kind: 'loading' });
  const { buildScene } = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let handle: { readonly dispose: () => void } | null = null;
    let cancelled = false;
    setState({ kind: 'loading' });
    void buildScene(canvas).then((outcome) => {
      if (cancelled) {
        if (outcome.kind === 'ok') outcome.handle.dispose();
        return;
      }
      if (outcome.kind === 'ok') {
        handle = outcome.handle;
        setState({ kind: 'ready' });
      } else {
        setState({ kind: 'failed', reason: outcome.reason });
      }
    });
    return () => {
      cancelled = true;
      handle?.dispose();
    };
  }, [buildScene]);

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
          ref={canvasRef}
          width={VIEWER_CANVAS_WIDTH_PX}
          height={VIEWER_CANVAS_HEIGHT_PX}
          aria-label={props.canvasAriaLabel}
          style={canvasStyle}
        />
        {state.kind === 'loading' ? <p style={hintStyle}>Building the 3D surface…</p> : null}
        {state.kind === 'failed' ? (
          <p style={hintStyle} role="alert">
            3D view unavailable: {state.reason}
          </p>
        ) : null}
        {state.kind === 'ready' ? (
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
