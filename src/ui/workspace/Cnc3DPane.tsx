// Cnc3DPane — the persistent, collapsible 3D result pane (ADR-105 G9):
// Easel's split-view. While designing in CNC mode it continuously simulates
// the current job (compile → toolpath → removal grid, deferred so typing
// stays snappy) and renders the stock + cut heightfield through the ADR-102
// three.js scene. UI-only; the compile path is the same one Preview uses.

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { reliefSurfaceMesh } from '../../core/relief';
import { toSceneCoords } from '../../core/devices';
import {
  computeRemovalGrid,
  downsampleRemovalGrid,
  DEFAULT_CELL_MM,
  kernelForTool,
  type RemovalGrid,
} from '../../core/sim';
import { activeCncTool, type OutputScope, type Project } from '../../core/scene';
import { useOutputScope, useStore } from '../state';
import {
  createReliefThreeScene,
  type ReliefSceneHandle,
} from '../relief-viewer/relief-three-scene';
import { buildPreviewToolpath } from './draw-preview';
import { useCncPaneWidth } from './use-cnc-pane-width';

// Coarser than the Preview grid — the pane recomputes on every edit.
const PANE_TARGET_CELLS_PER_AXIS = 500;
const PANE_DISPLAY_CELLS_ACROSS = 300;
const CANVAS_WIDTH_PX = 244;
const CANVAS_HEIGHT_PX = 240;

type PaneSceneState = 'loading' | 'ready' | 'failed';

export function Cnc3DPane(): JSX.Element | null {
  const project = useStore((s) => s.project);
  // Value-stable across hover (setCursorMm) — subscribing to currentOutputScope
  // directly returned a fresh object each store update, so the removal-grid
  // useMemo below recompiled the ~500×500 grid on every pointer move (PRF-01).
  const outputScope = useOutputScope();
  const [collapsed, setCollapsed] = useState(false);
  const resize = useCncPaneWidth();
  const deferredProject = useDeferredValue(project);
  const grid = useDesignRemovalGrid(deferredProject, outputScope, collapsed);
  if (project.machine?.kind !== 'cnc') return null;
  return (
    <aside
      aria-label="3D result pane"
      className="lf-rail"
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
      <div style={headerStyle}>
        {!collapsed && <span style={titleStyle}>3D result</span>}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand 3D result pane' : 'Collapse 3D result pane'}
          title={
            collapsed
              ? 'Show the live 3D view of the simulated cut.'
              : 'Hide the 3D pane to widen the canvas.'
          }
        >
          {collapsed ? '◂ 3D' : '▸'}
        </button>
      </div>
      {!collapsed && <PaneScene grid={grid} stockThicknessMm={stockThicknessMm(project)} />}
      {!collapsed && grid === null && (
        <p style={hintStyle}>Add CNC content on an output layer to see the simulated result.</p>
      )}
    </aside>
  );
}

function stockThicknessMm(project: Project): number {
  return project.machine?.kind === 'cnc' ? project.machine.stock.thicknessMm : 0;
}

// Design-time removal grid: full job at coarse resolution, scene-space stock
// rect (same frame as the Preview grid, so orientation matches the dialog).
function useDesignRemovalGrid(
  project: Project,
  outputScope: OutputScope,
  collapsed: boolean,
): RemovalGrid | null {
  return useMemo(() => {
    const machine = project.machine;
    if (collapsed || machine === undefined || machine.kind !== 'cnc') return null;
    const toolpath = buildPreviewToolpath(project, { outputScope });
    if (toolpath === null || toolpath.totalLength <= 0) return null;
    const stock = machine.stock;
    const a = toSceneCoords(stock.originOffset, project.device);
    const b = toSceneCoords(
      { x: stock.originOffset.x + stock.widthMm, y: stock.originOffset.y + stock.heightMm },
      project.device,
    );
    const widthMm = Math.abs(b.x - a.x);
    const heightMm = Math.abs(b.y - a.y);
    const mmPerCell = Math.max(
      DEFAULT_CELL_MM,
      Math.max(widthMm, heightMm) / PANE_TARGET_CELLS_PER_AXIS,
    );
    const kernel = kernelForTool(activeCncTool(machine), mmPerCell);
    const result = computeRemovalGrid(
      toolpath,
      {
        originX: Math.min(a.x, b.x),
        originY: Math.min(a.y, b.y),
        widthMm,
        heightMm,
        mmPerCell,
      },
      kernel,
    );
    return result.kind === 'ok' ? result.grid : null;
  }, [project, outputScope, collapsed]);
}

function PaneScene(props: {
  readonly grid: RemovalGrid | null;
  readonly stockThicknessMm: number;
}): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<ReliefSceneHandle | null>(null);
  const [state, setState] = useState<PaneSceneState>('loading');
  const { grid, stockThicknessMm: thickness } = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || grid === null) return;
    let cancelled = false;
    setState('loading');
    const display = downsampleRemovalGrid(grid, PANE_DISPLAY_CELLS_ACROSS);
    void createReliefThreeScene(canvas, reliefSurfaceMesh(display), thickness)
      .then((outcome) => {
        if (cancelled) {
          if (outcome.kind === 'ok') outcome.handle.dispose();
          return;
        }
        if (outcome.kind === 'ok') {
          handleRef.current = outcome.handle;
          // The pane is resizable, so fit the freshly-built scene to the
          // canvas's actual laid-out size rather than its mount-time attrs.
          outcome.handle.resize(canvas.clientWidth, canvas.clientHeight);
          setState('ready');
        } else {
          setState('failed');
        }
      })
      .catch(() => {
        if (!cancelled) setState('failed');
      });
    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [grid, thickness]);

  // Keep the renderer buffer in step with the resizable pane so the 3D view
  // stays crisp at any width (the scene renders on demand, not on a rAF loop).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      handleRef.current?.resize(canvas.clientWidth, canvas.clientHeight);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  if (grid === null) return null;
  return (
    <>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH_PX}
        height={CANVAS_HEIGHT_PX}
        aria-label="Live 3D cut result"
        style={canvasStyle}
      />
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
    flexShrink: 0,
    position: 'relative', // anchors the absolutely-positioned resize handle
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '8px 8px',
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
const titleStyle: React.CSSProperties = { fontWeight: 600 };
const canvasStyle: React.CSSProperties = {
  display: 'block',
  width: '100%', // fill the resizable pane; the ResizeObserver re-fits the buffer
  height: CANVAS_HEIGHT_PX,
  borderRadius: 4,
};
const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '4px 0 0 0',
};
