// Cnc3DPane — the persistent, collapsible 3D result pane (ADR-105 G9):
// Easel's split-view. While designing in CNC mode it continuously simulates
// the current job (compile → toolpath → removal grid, deferred so typing
// stays snappy) and renders the stock + cut heightfield through the ADR-102
// three.js scene. UI-only; the compile path is the same one Preview uses.

import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import type { OutputScope, Project } from '../../core/scene';
import { liveViewerState } from '../cnc-viewer3d/viewer3d-live-run';
import { useOutputScope, useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { Cnc3DFullPage } from './Cnc3DFullPage';
import { Cnc3DPaneToggle } from './Cnc3DPaneToggle';
import { computeDesignSceneSource } from './design-scene-source';
import { useCnc3dScene, type DesignSceneSource } from './use-cnc-3d-scene';
import { useCncCanvasFocus } from './use-cnc-canvas-focus';
import { useCanvasMotionOverlay } from './use-canvas-motion-overlay';
import { useCncPaneWidth } from './use-cnc-pane-width';

const CANVAS_WIDTH_PX = 244;
const CANVAS_HEIGHT_PX = 240;

export function Cnc3DPane(): JSX.Element | null {
  const project = useStore((s) => s.project);
  // Value-stable across hover (setCursorMm) — subscribing to currentOutputScope
  // directly returned a fresh object each store update, so the removal-grid
  // useMemo below recompiled the ~500×500 grid on every pointer move (PRF-01).
  const outputScope = useOutputScope();
  const { collapsed, toggleCollapsed } = useCncCanvasFocus();
  const resize = useCncPaneWidth();
  const deferredProject = useDeferredValue(project);
  const source = useDesignSceneSource(deferredProject, outputScope, collapsed);
  if (project.machine?.kind !== 'cnc') return null;
  return (
    <aside
      aria-label="3D result pane"
      className="lf-rail"
      data-cnc-layout-mode={collapsed ? 'canvas-focus' : 'split-view'}
      style={paneStyle(collapsed, resize.widthPx)}
    >
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize 3D result pane"
          tabIndex={0}
          title="Drag (or use ← / →) to resize the 3D result pane."
          style={resizeHandleStyle}
          onPointerDown={resize.onHandlePointerDown}
          onKeyDown={resize.onHandleKeyDown}
        />
      )}
      <div style={collapsed ? collapsedHeaderStyle : headerStyle}>
        {!collapsed && <span style={titleStyle}>3D result</span>}
        <Cnc3DPaneToggle collapsed={collapsed} onToggle={toggleCollapsed} />
      </div>
      {!collapsed && <PaneScene source={source} stockThicknessMm={stockThicknessMm(project)} />}
      {!collapsed && source === null && (
        <p style={hintStyle}>Add CNC content on an output layer to see the simulated result.</p>
      )}
    </aside>
  );
}

function stockThicknessMm(project: Project): number {
  return project.machine?.kind === 'cnc' ? project.machine.stock.thicknessMm : 0;
}

// Design-time scene source (design-scene-source.ts): removal grid, 3D moves,
// and bit silhouette from ONE prepared output, with each tool section stamped
// by its own bit's kernel (H.7). Memoized against the deferred project so
// typing stays snappy and hover stays value-stable (PRF-01).
function useDesignSceneSource(
  project: Project,
  outputScope: OutputScope,
  collapsed: boolean,
): DesignSceneSource | null {
  return useMemo(
    () => (collapsed ? null : computeDesignSceneSource(project, outputScope)),
    [project, outputScope, collapsed],
  );
}

function PaneScene(props: {
  readonly source: DesignSceneSource | null;
  readonly stockThicknessMm: number;
}): JSX.Element | null {
  const { source, stockThicknessMm } = props;
  // Same scrubber the 2D preview uses, so the two views cannot disagree about
  // where in the program the operator is looking.
  const scrubberT = useUiStore((s) => s.scrubberT);
  // While a job streams, the controller — not the scrubber — says where the
  // bit is and how much of the route has actually been cut.
  const live = liveViewerState(
    useCanvasMotionOverlay(
      useStore((s) => s.project),
      false,
    )?.run ?? null,
  );
  const [isFullPage, setIsFullPage] = useState(false);
  const closeFullPage = useCallback(() => setIsFullPage(false), []);
  const { canvasRef, state } = useCnc3dScene(source, stockThicknessMm, scrubberT, live);

  if (source === null) return null;
  return (
    <>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH_PX}
        height={CANVAS_HEIGHT_PX}
        aria-label="Live 3D cut result"
        style={canvasStyle}
      />
      <button
        type="button"
        onClick={() => setIsFullPage(true)}
        style={fullPageButtonStyle}
        title="Open the 3D result at full window size."
      >
        Open full page
      </button>
      {isFullPage && (
        <Cnc3DFullPage
          source={source}
          stockThicknessMm={stockThicknessMm}
          scrubberT={scrubberT}
          live={live}
          onClose={closeFullPage}
        />
      )}
      {state === 'failed' ? (
        <p style={hintStyle} role="alert">
          3D view unavailable in this browser.
        </p>
      ) : (
        <p style={hintStyle}>Drag to orbit, scroll to zoom. Updates as you edit.</p>
      )}
    </>
  );
}

function paneStyle(collapsed: boolean, widthPx: number): React.CSSProperties {
  return {
    // Operator-set width (ADR-191): narrowing the pane hands room back to the
    // adjacent fixed columns so their content stops clipping off the right edge
    // when the machine rail and Cuts/Layers are held open on a laptop window.
    width: collapsed ? 44 : widthPx,
    boxSizing: 'border-box',
    flexShrink: 0,
    position: 'relative', // anchors the absolutely-positioned resize handle
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: collapsed ? 4 : 8,
    fontFamily: 'system-ui, sans-serif',
    fontSize: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  };
}
// Thin grab strip on the pane's left edge (the seam with the flexible canvas).
const resizeHandleStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  bottom: 0,
  width: 6,
  cursor: 'col-resize',
  touchAction: 'none',
  zIndex: 1,
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
};
const collapsedHeaderStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
};
const titleStyle: React.CSSProperties = { fontWeight: 600 };
const canvasStyle: React.CSSProperties = {
  display: 'block',
  width: '100%', // fill the resizable pane; the ResizeObserver re-fits the buffer
  height: CANVAS_HEIGHT_PX,
  borderRadius: 4,
};
const fullPageButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  cursor: 'pointer',
  fontSize: 11,
};
const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '4px 0 0 0',
};
