// Viewer3DDialogShell — shared chrome for the ADR-102 3D viewers (relief
// surface, cut preview): accessible dialog, canvas, loading / ready / failed
// state machine, and scene lifecycle (cancel + dispose on unmount).

import { useId, useRef, useState } from 'react';
import { Dialog } from '../kit';
import {
  useViewerDialogScene,
  type ViewerDialogSceneBuilder,
  type ViewerDialogState,
} from './use-viewer-dialog-scene';
import './viewer3d-dialog.css';

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
  // Display-only disclosure such as bounded preview coarsening. Never a gate.
  readonly notice?: string;
  readonly preparationFailure?: string;
  // A newer surface is being prepared; the current one stays on screen.
  readonly updating?: boolean;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hintId = useId();
  const { buildScene } = props;
  const state = useViewerDialogScene(buildScene, canvasRef);
  const canvasGeneration = useCanvasGeneration(buildScene, state);

  const visibleState: ViewerDialogState =
    buildScene === null
      ? props.preparationFailure === undefined
        ? { kind: 'loading' }
        : { kind: 'failed', reason: props.preparationFailure }
      : state.buildScene === buildScene
        ? state.value
        : { kind: 'loading' };

  return (
    <Dialog
      ariaLabel={props.ariaLabel}
      size="xl"
      panelClassName="lf-dialog--viewer3d"
      onClose={props.onClose}
    >
      <div className="lf-viewer3d-dialog__header">
        <h2 className="lf-viewer3d-dialog__title">{props.title}</h2>
        <button type="button" onClick={props.onClose} title="Close the 3D viewer">
          Close
        </button>
      </div>
      <canvas
        key={canvasGeneration}
        ref={canvasRef}
        width={VIEWER_CANVAS_WIDTH_PX}
        height={VIEWER_CANVAS_HEIGHT_PX}
        aria-label={props.canvasAriaLabel}
        aria-describedby={hintId}
        aria-busy={visibleState.kind === 'loading' || props.updating === true}
        tabIndex={0}
        className="lf-viewer3d-dialog__canvas"
      />
      {props.notice === undefined ? null : (
        <p className="lf-viewer3d-dialog__hint" role="status" style={noticeStyle}>
          {props.notice}
        </p>
      )}
      <ViewerStateHint id={hintId} state={visibleState} updating={props.updating === true} />
    </Dialog>
  );
}

// A new surface reuses the live canvas and keeps the camera (ADR-425). A
// transferred canvas cannot be transferred again, so only a failed renderer
// gets a fresh element, letting the next surface start over.
function useCanvasGeneration(
  buildScene: ViewerDialogSceneBuilder | null,
  state: ReturnType<typeof useViewerDialogScene>,
): number {
  const [tracked, setTracked] = useState({ buildScene, generation: 0 });
  if (tracked.buildScene !== buildScene && buildScene !== null) {
    const failed = state.value.kind === 'failed' && state.buildScene === tracked.buildScene;
    setTracked({ buildScene, generation: tracked.generation + (failed ? 1 : 0) });
  }
  return tracked.generation;
}

function ViewerStateHint(props: {
  readonly id: string;
  readonly state: ViewerDialogState;
  readonly updating: boolean;
}): JSX.Element {
  if (props.state.kind === 'loading') {
    return (
      <p id={props.id} className="lf-viewer3d-dialog__hint" role="status" aria-live="polite">
        Building the 3D surface…
      </p>
    );
  }
  if (props.state.kind === 'ready' && props.updating) {
    return (
      <p id={props.id} className="lf-viewer3d-dialog__hint" role="status" aria-live="polite">
        Updating the 3D surface…
      </p>
    );
  }
  if (props.state.kind === 'failed') {
    return (
      <p id={props.id} className="lf-viewer3d-dialog__hint" role="alert">
        3D view unavailable: {props.state.reason}
      </p>
    );
  }
  return (
    <p id={props.id} className="lf-viewer3d-dialog__hint">
      Left-drag to pan, right-drag to orbit, or scroll to zoom. Keyboard: focus the preview, use
      Arrow keys to pan, Shift+Arrow keys to orbit, and + or - to zoom. Depth is true to scale.
    </p>
  );
}
const noticeStyle: React.CSSProperties = {
  color: 'var(--lf-warning-fg)',
};
