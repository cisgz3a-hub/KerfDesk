// Relief3DViewerDialog — the ADR-101 3D relief viewer. Rebuilds the
// heightmap at display resolution, converts it to plain mesh arrays in pure
// core, and hands them to the lazy three.js scene module. Environments
// without WebGL get a plain-text fallback (what jsdom tests assert).

import { useEffect, useRef, useState } from 'react';
import { heightmapCellSize, meshToHeightmap, reliefSurfaceMesh } from '../../core/relief';
import type { ReliefObject } from '../../core/scene';
import { createReliefThreeScene, type ReliefSceneHandle } from './relief-three-scene';

// ~256 cells across keeps the display mesh under ~130k triangles.
const DISPLAY_CELLS_ACROSS = 256;
const MIN_DISPLAY_CELL_MM = 0.25;
const CANVAS_WIDTH_PX = 720;
const CANVAS_HEIGHT_PX = 480;

type ViewerState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly reason: string };

export function Relief3DViewerDialog(props: {
  readonly relief: ReliefObject;
  readonly stockThicknessMm: number;
  readonly onClose: () => void;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<ViewerState>({ kind: 'loading' });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let handle: ReliefSceneHandle | null = null;
    let cancelled = false;
    void buildScene(canvas, props.relief, props.stockThicknessMm).then((outcome) => {
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
  }, [props.relief, props.stockThicknessMm]);

  return (
    <div role="dialog" aria-label="Relief 3D viewer" style={backdropStyle}>
      <div style={panelStyle}>
        <div style={headerStyle}>
          <h3 style={titleStyle}>
            {props.relief.source} — {props.relief.targetWidthMm.toFixed(0)} mm wide ×{' '}
            {props.relief.reliefDepthMm.toFixed(1)} mm deep
          </h3>
          <button type="button" onClick={props.onClose} title="Close the 3D viewer">
            Close
          </button>
        </div>
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH_PX}
          height={CANVAS_HEIGHT_PX}
          aria-label="Relief 3D preview"
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

async function buildScene(
  canvas: HTMLCanvasElement,
  relief: ReliefObject,
  stockThicknessMm: number,
): Promise<Awaited<ReturnType<typeof createReliefThreeScene>>> {
  try {
    const mmPerCell = Math.max(MIN_DISPLAY_CELL_MM, relief.targetWidthMm / DISPLAY_CELLS_ACROSS);
    const heightmap = meshToHeightmap(
      { positions: Float32Array.from(relief.meshPositions) },
      {
        targetWidthMm: relief.targetWidthMm,
        reliefDepthMm: relief.reliefDepthMm,
        emptyCells: relief.emptyCells,
        mmPerCell: heightmapCellSize(relief.targetWidthMm, relief.targetWidthMm, mmPerCell),
      },
    );
    if (heightmap.kind === 'error') return { kind: 'no-webgl', reason: heightmap.reason };
    return await createReliefThreeScene(
      canvas,
      reliefSurfaceMesh(heightmap.heightmap),
      stockThicknessMm,
    );
  } catch (err) {
    return {
      kind: 'no-webgl',
      reason: err instanceof Error ? err.message : 'The 3D renderer failed to start.',
    };
  }
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
