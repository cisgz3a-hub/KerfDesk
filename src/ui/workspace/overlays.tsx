// Workspace overlays — UI chrome that sits above the canvas: empty-state
// hint (F-A2), drag-to-import zone (F-A3), drag-readout chip (F-A6),
// preview scrubber (F-A8). Extracted from Workspace.tsx to keep that file
// under the 250-line soft cap per CLAUDE.md.

import type { Project } from '../../core/scene';
import { transformedBBox } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { computeView } from './view-transform';

export function EmptyHint(): JSX.Element {
  return (
    <div style={emptyHintStyle} aria-hidden="true">
      Drag an SVG here, or use File → Import
    </div>
  );
}

export function DragOverlay(): JSX.Element {
  return (
    <div style={dragOverlayStyle} aria-hidden="true">
      <span style={dragOverlayLabelStyle}>Drop to import</span>
    </div>
  );
}

// Visible zoom controls: −, percentage readout, +, fit. Sits at the
// bottom-right of the canvas overlay. Surfaces the same actions that
// Ctrl+Wheel and the +/-/0/F shortcuts already do — most users don't
// discover the keyboard bindings, so the buttons make zoom obvious.
// 1.25× per click matches the keyboard step and Ctrl+Wheel notch.
const ZOOM_STEP = 1.25;
export function ZoomControls(): JSX.Element {
  const zoomFactor = useUiStore((s) => s.zoomFactor);
  const zoomBy = useUiStore((s) => s.zoomBy);
  const resetView = useUiStore((s) => s.resetView);
  const fitToSelection = useStore((s) => s.fitToSelection);
  const percent = Math.round(zoomFactor * 100);
  return (
    <div className="lf-chip" style={zoomControlsStyle} role="group" aria-label="Zoom">
      <button
        type="button"
        onClick={() => zoomBy(1 / ZOOM_STEP)}
        title="Zoom out (−)"
        aria-label="Zoom out"
        style={zoomBtnStyle}
      >
        −
      </button>
      <span
        style={zoomReadoutStyle}
        title="Click to fit-to-bed (F or 0)"
        role="button"
        tabIndex={0}
        onClick={resetView}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            resetView();
          }
        }}
      >
        {percent}%
      </span>
      <button
        type="button"
        onClick={() => zoomBy(ZOOM_STEP)}
        title="Zoom in (+)"
        aria-label="Zoom in"
        style={zoomBtnStyle}
      >
        +
      </button>
      <button
        type="button"
        onClick={() => fitToSelection()}
        title="Fit to selection (Shift+F)"
        aria-label="Fit to selection"
        style={zoomBtnStyle}
      >
        ⊙
      </button>
      <button
        type="button"
        onClick={resetView}
        title="Fit to bed (F)"
        aria-label="Fit to bed"
        style={zoomBtnStyle}
      >
        ⊡
      </button>
    </div>
  );
}

export function PreviewScrubber(): JSX.Element {
  const scrubberT = useUiStore((s) => s.scrubberT);
  const setScrubberT = useUiStore((s) => s.setScrubberT);
  return (
    <div className="lf-chip" style={scrubberContainerStyle}>
      <input
        type="range"
        min={0}
        max={1}
        step={0.005}
        value={scrubberT}
        onChange={(e) => setScrubberT(Number.parseFloat(e.target.value))}
        aria-label="Preview toolpath scrubber"
        style={scrubberInputStyle}
      />
      <span style={scrubberLabelStyle}>{Math.round(scrubberT * 100)}%</span>
    </div>
  );
}

// Live X/Y or W×H or angle label rendered as a floating chip near the
// dragged object's top-right corner.
export function DragReadout(props: {
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly selectedId: string | null;
  readonly kind: 'move' | 'scale' | 'rotate';
  readonly viewState: { readonly zoomFactor: number; readonly panX: number; readonly panY: number };
}): JSX.Element | null {
  const canvas = props.canvasRef.current;
  const obj = props.project.scene.objects.find((o) => o.id === props.selectedId);
  if (canvas === null || obj === undefined) return null;
  const view = computeView(
    canvas.width,
    canvas.height,
    props.project.device.bedWidth,
    props.project.device.bedHeight,
    props.viewState,
  );
  const bbox = transformedBBox(obj);
  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  const label = readoutLabel(props.kind, obj, bbox, w, h);
  // Convert bed-mm to CSS px. The canvas element scales (width/height attrs
  // vs CSS layout size) so we map through the canvas's CSS bounding rect.
  const rect = canvas.getBoundingClientRect();
  const cssScaleX = rect.width / canvas.width;
  const cssScaleY = rect.height / canvas.height;
  const cssX = (view.offsetX + bbox.maxX * view.scale) * cssScaleX;
  const cssY = (view.offsetY + bbox.minY * view.scale) * cssScaleY;
  return (
    <div style={{ ...dragReadoutStyle, left: cssX + 8, top: cssY - 8 }} aria-hidden="true">
      {label}
    </div>
  );
}

function readoutLabel(
  kind: 'move' | 'scale' | 'rotate',
  obj: { readonly transform: { readonly rotationDeg: number } },
  bbox: { readonly minX: number; readonly minY: number },
  w: number,
  h: number,
): string {
  if (kind === 'move') return `X ${bbox.minX.toFixed(1)}, Y ${bbox.minY.toFixed(1)} mm`;
  if (kind === 'scale') return `${w.toFixed(1)} × ${h.toFixed(1)} mm`;
  return `${obj.transform.rotationDeg.toFixed(1)}°`;
}

const emptyHintStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  // Dark-on-light: this hint sits on the always-light viewport (ADR-047).
  color: '#888',
  fontStyle: 'italic',
  fontSize: 14,
  fontFamily: 'system-ui, sans-serif',
};
const dragOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 12,
  border: '3px dashed var(--lf-accent)',
  borderRadius: 8,
  background: 'rgba(25, 118, 210, 0.08)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
};
const dragOverlayLabelStyle: React.CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 18,
  fontWeight: 600,
  color: 'var(--lf-accent-fg)',
  background: 'var(--lf-bg-1)',
  padding: '6px 16px',
  borderRadius: 4,
};
// Repositioned per mousemove — flat colors, no shadow (ADR-047 perf).
const dragReadoutStyle: React.CSSProperties = {
  position: 'absolute',
  background: 'var(--lf-accent)',
  color: '#fff',
  padding: '2px 6px',
  borderRadius: 3,
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 11,
  fontWeight: 600,
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
};
const scrubberContainerStyle: React.CSSProperties = {
  position: 'absolute',
  left: 24,
  right: 24,
  bottom: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  borderRadius: 4,
  padding: '6px 10px',
};
const scrubberInputStyle: React.CSSProperties = { flex: 1 };
const scrubberLabelStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 11,
  minWidth: 40,
  textAlign: 'right',
};
const zoomControlsStyle: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  bottom: 12,
  display: 'flex',
  alignItems: 'stretch',
  gap: 0,
  borderRadius: 4,
  overflow: 'hidden',
  fontFamily: 'system-ui, sans-serif',
};
const zoomBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 16,
  color: 'inherit',
  padding: 0,
};
const zoomReadoutStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 52,
  height: 28,
  borderLeft: '1px solid var(--lf-border-strong)',
  borderRight: '1px solid var(--lf-border-strong)',
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 11,
  cursor: 'pointer',
  userSelect: 'none',
};
