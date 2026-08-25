// Cut3DPreviewDialog — the ADR-103 G4 general 3D cut preview: the CNC
// preview's material-removal grid rendered as a shaded heightfield for ANY
// job (profiles, pockets, v-carves, drills — not just reliefs). Reuses the
// ADR-102 three.js scene + dialog shell; the grid is downsampled to display
// resolution in pure core first. Reflects the scrubber position — the 3D
// surface shows exactly what the 2D depth shading shows.

import { useMemo } from 'react';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { RemovalGrid } from '../../core/sim';
import { formatDisplayMillimetres } from '../format-display-millimetres';
import { cncCut3dDisplayResolution, previewResolutionMessage } from '../workspace/preview';
import { createCut3DOffscreenCoordinator } from './cut3d-offscreen-worker-client';
import { Viewer3DDialogShell } from './Viewer3DDialogShell';

// Display mesh arrays and smooth normals arrive from the bounded worker; this
// component owns only the lazy Three.js/WebGL presentation boundary.
export function Cut3DPreviewDialog(props: {
  readonly grid: RemovalGrid;
  readonly mesh: ReliefSurfaceMeshWithNormals | null;
  readonly surfaceRevision?: number;
  readonly unavailableReason?: string;
  readonly stockThicknessMm: number;
  readonly onClose: () => void;
}): JSX.Element {
  const { grid, mesh, stockThicknessMm } = props;
  const buildScene = useMemo(
    () =>
      mesh === null ? null : createCut3DOffscreenCoordinator(mesh, stockThicknessMm).buildScene,
    [mesh, stockThicknessMm],
  );
  const { widthMm, heightMm } = grid;
  const resolutionNotice = previewResolutionMessage(
    '3D cut preview',
    cncCut3dDisplayResolution(grid),
  );
  return (
    <Viewer3DDialogShell
      ariaLabel="Cut 3D preview"
      canvasAriaLabel="Cut 3D preview surface"
      title={`Cut preview — ${formatDisplayMillimetres(widthMm)} × ${formatDisplayMillimetres(heightMm)} mm stock`}
      onClose={props.onClose}
      {...(resolutionNotice === null ? {} : { notice: resolutionNotice })}
      buildScene={buildScene}
      {...(props.surfaceRevision === undefined ? {} : { canvasKey: props.surfaceRevision })}
      {...(props.unavailableReason === undefined
        ? {}
        : { preparationFailure: props.unavailableReason })}
    />
  );
}
