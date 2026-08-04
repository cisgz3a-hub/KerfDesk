import {
  reliefSurfaceMeshWithNormals,
  type ReliefSurfaceMeshWithNormals,
} from '../../core/relief/relief-surface-mesh';
import { downsampleRemovalGrid, type RemovalGrid } from '../../core/sim';

// ~360 display cells across ~= 260k triangles. This is presentation policy,
// not compilation policy, so it stays beside the workspace worker task.
export const CNC_CUT3D_DISPLAY_CELLS_ACROSS = 360;

/** Pure worker-side preparation for the explicit Cut 3D dialog. */
export function prepareCncCut3DSurface(grid: RemovalGrid): ReliefSurfaceMeshWithNormals {
  return reliefSurfaceMeshWithNormals(downsampleRemovalGrid(grid, CNC_CUT3D_DISPLAY_CELLS_ACROSS));
}
