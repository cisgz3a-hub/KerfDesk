// Instanced arrowhead mesh for the direction overlay (ADR-255 stage 14).
//
// One InstancedMesh for every arrow: a cone per placement would be dozens of
// draw calls and dozens of objects to dispose. Arrows are sized from the job
// so they read at any program scale.

import type * as ThreeNamespace from 'three';
import type { ArrowPlacement } from './direction-arrows';
import type { Viewer3dTheme } from './viewer3d-theme';

type ThreeModule = typeof ThreeNamespace;

export type ArrowMesh = ThreeNamespace.InstancedMesh<
  ThreeNamespace.ConeGeometry,
  ThreeNamespace.MeshBasicMaterial
>;

const ARROW_LENGTH_FRACTION = 0.02;
const ARROW_MIN_LENGTH_MM = 0.8;
const ARROW_ASPECT = 0.45;
/** ConeGeometry points along +Y, so instances rotate from +Y to the move. */
const CONE_AXIS = { x: 0, y: 1, z: 0 };

/**
 * Builds the arrow mesh for a set of placements, or null when there is
 * nothing to mark. `extentMm` is the job's size, used to scale the heads.
 */
export function createArrowMesh(
  three: ThreeModule,
  placements: ReadonlyArray<ArrowPlacement>,
  extentMm: number,
  theme: Viewer3dTheme,
): ArrowMesh | null {
  if (placements.length === 0) return null;
  const length = Math.max(ARROW_MIN_LENGTH_MM, extentMm * ARROW_LENGTH_FRACTION);
  const geometry = new three.ConeGeometry(length * ARROW_ASPECT, length, 8);
  const material = new three.MeshBasicMaterial({ color: theme.arrow });
  const mesh: ArrowMesh = new three.InstancedMesh(geometry, material, placements.length);
  const matrix = new three.Matrix4();
  const quaternion = new three.Quaternion();
  const axis = new three.Vector3(CONE_AXIS.x, CONE_AXIS.y, CONE_AXIS.z);
  const direction = new three.Vector3();
  const position = new three.Vector3();
  const unitScale = new three.Vector3(1, 1, 1);
  for (const [index, placement] of placements.entries()) {
    direction.set(placement.direction.x, placement.direction.y, placement.direction.z);
    quaternion.setFromUnitVectors(axis, direction);
    position.set(placement.position.x, placement.position.y, placement.position.z);
    matrix.compose(position, quaternion, unitScale);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  // Drawn over the toolpath: an arrow half-buried in the line it marks is
  // worse than no arrow.
  mesh.renderOrder = 2;
  return mesh;
}

export function disposeArrowMesh(scene: ThreeNamespace.Scene, mesh: ArrowMesh | null): void {
  if (mesh === null) return;
  scene.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
  mesh.dispose();
}
