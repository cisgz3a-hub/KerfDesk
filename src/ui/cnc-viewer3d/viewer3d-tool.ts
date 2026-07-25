// buildToolMesh — the cutter, drawn as the solid of revolution it is.
//
// The silhouette comes from core/sim's toolProfile, which samples the SAME
// function that stamps material away. So the bit on screen is the bit the
// simulation used: if the job runs a ball nose, the preview cannot show a
// flat end-mill.
//
// Semi-transparent on purpose. CAMotics does the same, and the reason is
// practical rather than decorative — an opaque tool hides exactly the cut the
// operator is trying to inspect, since the tool is always sitting in it.

import type * as ThreeNamespace from 'three';
import type { Object3D } from 'three';
import type { ToolProfilePoint } from '../../core/sim';
import { viewer3dTheme } from '../theme/viewer3d-theme';

type ThreeModule = typeof ThreeNamespace;

export type ToolMeshHandle = {
  readonly object: Object3D;
  readonly dispose: () => void;
};

// Radial segments around the axis. A bit is small on screen; 32 is round.
const LATHE_SEGMENTS = 32;

/**
 * Builds the cutter mesh at a position in the viewport's local frame.
 *
 * @param three The dynamically-imported three module.
 * @param profile Half-silhouette from core/sim toolProfile, tip at height 0.
 * @param positionMm Where the tool TIP sits, in the viewport's local frame.
 * @returns The tool mesh plus its disposer.
 */
export function buildToolMesh(
  three: ThreeModule,
  profile: ReadonlyArray<ToolProfilePoint>,
  positionMm: { readonly x: number; readonly y: number; readonly z: number },
): ToolMeshHandle {
  // LatheGeometry revolves around Y and this viewport is Z-up, so the profile
  // is authored into the XY plane and the whole mesh is stood upright below.
  const points = profile.map((point) => new three.Vector2(point.radiusMm, point.heightMm));
  const geometry = new three.LatheGeometry(points, LATHE_SEGMENTS);
  const material = new three.MeshStandardMaterial({
    color: viewer3dTheme.tool.body,
    transparent: true,
    opacity: viewer3dTheme.tool.opacity,
    // Without this the tool's own back faces sort against its front faces and
    // the bit reads as a hollow shell rather than a solid.
    side: three.DoubleSide,
    depthWrite: false,
    roughness: 0.35,
    metalness: 0.6,
  });

  const mesh = new three.Mesh(geometry, material);
  // Stand the lathe's +Y axis up into the viewport's +Z.
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(positionMm.x, positionMm.y, positionMm.z);
  // Drawn after the surface so its transparency blends over the cut rather
  // than being rejected by depth order.
  mesh.renderOrder = 10;

  return {
    object: mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
