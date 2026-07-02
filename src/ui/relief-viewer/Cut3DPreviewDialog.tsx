// Cut3DPreviewDialog — the ADR-102 G4 general 3D cut preview: the CNC
// preview's material-removal grid rendered as a shaded heightfield for ANY
// job (profiles, pockets, v-carves, drills — not just reliefs). Reuses the
// ADR-101 three.js scene + dialog shell; the grid is downsampled to display
// resolution in pure core first. Reflects the scrubber position — the 3D
// surface shows exactly what the 2D depth shading shows.

import { useCallback } from 'react';
import { reliefSurfaceMesh } from '../../core/relief';
import { downsampleRemovalGrid, type RemovalGrid } from '../../core/sim';
import { createReliefThreeScene } from './relief-three-scene';
import { Viewer3DDialogShell } from './Viewer3DDialogShell';

// ~360 display cells across ≈ 260k triangles — smooth on integrated GPUs.
const DISPLAY_CELLS_ACROSS = 360;

export function Cut3DPreviewDialog(props: {
  readonly grid: RemovalGrid;
  readonly stockThicknessMm: number;
  readonly onClose: () => void;
}): JSX.Element {
  const { grid, stockThicknessMm } = props;
  const buildScene = useCallback(
    async (canvas: HTMLCanvasElement) => {
      try {
        const display = downsampleRemovalGrid(grid, DISPLAY_CELLS_ACROSS);
        // RemovalGrid is structurally a Heightmap (cells + depth field), so
        // the relief mesh builder consumes it directly.
        return await createReliefThreeScene(canvas, reliefSurfaceMesh(display), stockThicknessMm);
      } catch (err) {
        return {
          kind: 'no-webgl' as const,
          reason: err instanceof Error ? err.message : 'The 3D renderer failed to start.',
        };
      }
    },
    [grid, stockThicknessMm],
  );
  const widthMm = grid.widthCells * grid.mmPerCell;
  const heightMm = grid.heightCells * grid.mmPerCell;
  return (
    <Viewer3DDialogShell
      ariaLabel="Cut 3D preview"
      canvasAriaLabel="Cut 3D preview surface"
      title={`Cut preview — ${widthMm.toFixed(0)} × ${heightMm.toFixed(0)} mm stock`}
      onClose={props.onClose}
      buildScene={buildScene}
    />
  );
}
