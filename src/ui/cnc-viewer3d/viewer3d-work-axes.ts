import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { PickVec3 } from './viewer3d-picking';

/** Program work zero and positive work-axis directions in the shared viewer frame. */
export type ViewerWorkAxes = {
  readonly originMm: PickVec3;
  readonly xDirection: 1 | -1;
  readonly yDirection: 1 | -1;
};

/** Display metadata travels with the exact surface through worker replacements. */
export type Cut3DSurfaceMesh = ReliefSurfaceMeshWithNormals & {
  readonly workAxes?: ViewerWorkAxes | null;
};
