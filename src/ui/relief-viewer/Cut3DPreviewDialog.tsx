// Cut3DPreviewDialog — the ADR-103 G4 general 3D cut preview: the CNC
// preview's material-removal grid rendered as a shaded heightfield for ANY
// job (profiles, pockets, v-carves, drills — not just reliefs). Reuses the
// ADR-102 three.js scene + dialog shell; the grid is downsampled to display
// resolution in pure core first. Reflects the scrubber position — the 3D
// surface shows exactly what the 2D depth shading shows.

import { useMemo } from 'react';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { RemovalGrid } from '../../core/sim';
import { createReliefThreeScene } from './relief-three-scene';
import { Viewer3DDialogShell } from './Viewer3DDialogShell';

// Display mesh arrays and smooth normals arrive from the bounded worker; this
// component owns only the lazy Three.js/WebGL presentation boundary.
export function Cut3DPreviewDialog(props: {
  readonly grid: RemovalGrid;
  readonly mesh: ReliefSurfaceMeshWithNormals | null;
  readonly unavailableReason?: string;
  readonly stockThicknessMm: number;
  readonly onClose: () => void;
}): JSX.Element {
  const { grid, mesh, stockThicknessMm } = props;
  const buildScene = useMemo(
    () =>
      mesh === null
        ? null
        : async (canvas: HTMLCanvasElement) => {
            try {
              return await createReliefThreeScene(canvas, mesh, stockThicknessMm);
            } catch (err) {
              return {
                kind: 'no-webgl' as const,
                reason: err instanceof Error ? err.message : 'The 3D renderer failed to start.',
              };
            }
          },
    [mesh, stockThicknessMm],
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
      {...(props.unavailableReason === undefined
        ? {}
        : { preparationFailure: props.unavailableReason })}
    />
  );
}
