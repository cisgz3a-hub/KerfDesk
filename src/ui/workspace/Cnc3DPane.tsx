// Cnc3DPane — the persistent, collapsible 3D result pane (ADR-105 G9):
// Easel's split-view. While designing in CNC mode it continuously simulates
// the current job (compile → toolpath → removal grid, deferred so typing
// stays snappy) and renders the stock + cut heightfield through the ADR-102
// three.js scene. UI-only; the compile path is the same one Preview uses.

import { useCallback, useDeferredValue, useState } from 'react';
import type { Project } from '../../core/scene';
import { useOutputScope, useStore } from '../state';
import { WoodView } from '../wood-viewer';
import { Cnc3DFullPage } from './Cnc3DFullPage';
import { Cnc3DPaneToggle } from './Cnc3DPaneToggle';
import type { DesignSceneSource } from './use-cnc-3d-scene';
import { useDesignSceneSource } from './use-design-scene-source';
import { useCncCanvasFocus } from './use-cnc-canvas-focus';
import { useCncPaneWidth } from './use-cnc-pane-width';

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

// ADR-285: the pane now hosts the ported standalone preview verbatim. The
// toolpath overlay, scrubber playback, X-ray, section plane, depth probe and
// live-run tracking were deliberately removed with the old scene — the
// reference page has none of them, and an identical port was the requirement.
function PaneScene(props: {
  readonly source: DesignSceneSource | null;
  readonly stockThicknessMm: number;
}): JSX.Element | null {
  const { source, stockThicknessMm } = props;
  const [isFullPage, setIsFullPage] = useState(false);
  const closeFullPage = useCallback(() => setIsFullPage(false), []);
  if (source === null) return null;
  // The artwork-scoped fine grid when there is one: a stock-wide grid gives a
  // V-groove about one cell, which is what made the carve read as blocks.
  const grid = source.detailGrid ?? source.grid;
  return (
    <>
      <WoodView grid={grid} stockThicknessMm={stockThicknessMm} heightPx={CANVAS_HEIGHT_PX} />
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
          onClose={closeFullPage}
        />
      )}
      <p style={hintStyle}>Drag to orbit, scroll to zoom. Updates as you edit.</p>
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
