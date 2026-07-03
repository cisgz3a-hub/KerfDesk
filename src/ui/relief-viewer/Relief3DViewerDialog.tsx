// Relief3DViewerDialog — the ADR-102 3D relief viewer. Rebuilds the
// heightmap at display resolution, converts it to plain mesh arrays in pure
// core, and hands them to the lazy three.js scene module through the shared
// dialog shell. Environments without WebGL get a plain-text fallback (what
// jsdom tests assert).

import { useCallback } from 'react';
import { heightmapCellSize, meshToHeightmap, reliefSurfaceMesh } from '../../core/relief';
import type { ReliefObject } from '../../core/scene';
import { createReliefThreeScene } from './relief-three-scene';
import { Viewer3DDialogShell } from './Viewer3DDialogShell';

// ~256 cells across keeps the display mesh under ~130k triangles.
const DISPLAY_CELLS_ACROSS = 256;
const MIN_DISPLAY_CELL_MM = 0.25;

export function Relief3DViewerDialog(props: {
  readonly relief: ReliefObject;
  readonly stockThicknessMm: number;
  readonly onClose: () => void;
}): JSX.Element {
  const { relief, stockThicknessMm } = props;
  const buildScene = useCallback(
    (canvas: HTMLCanvasElement) => buildReliefScene(canvas, relief, stockThicknessMm),
    [relief, stockThicknessMm],
  );
  return (
    <Viewer3DDialogShell
      ariaLabel="Relief 3D viewer"
      canvasAriaLabel="Relief 3D preview"
      title={`${relief.source} — ${relief.targetWidthMm.toFixed(0)} mm wide × ${relief.reliefDepthMm.toFixed(1)} mm deep`}
      onClose={props.onClose}
      buildScene={buildScene}
    />
  );
}

async function buildReliefScene(
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
