// viewer3d-picking — the pure half of hovering the machined surface.
//
// Raycasting itself needs three and a live scene, so it stays in the scene
// module. What lives here is the arithmetic on either side of it: pointer
// pixels to normalised device coordinates going in, and viewport-local
// millimetres back to scene frame coming out.
//
// The frame conversion is the exact inverse of the one the surface geometry is
// baked with (mirror in Y, then recentre). Writing it here, next to nothing
// else, keeps it checkable against ADR-257 §2 by reading two functions rather
// than tracing a scene graph.
//
// PURE: numbers in, numbers out. No three import, no DOM.

export type PickVec2 = { readonly x: number; readonly y: number };
export type PickVec3 = { readonly x: number; readonly y: number; readonly z: number };

/**
 * Converts pointer pixels to normalised device coordinates.
 *
 * @param offsetX Pointer X within the canvas, in CSS pixels.
 * @param offsetY Pointer Y within the canvas, in CSS pixels.
 * @param width Canvas width in CSS pixels.
 * @param height Canvas height in CSS pixels.
 * @returns NDC in -1..1, with +Y up as WebGL expects.
 */
export function pointerNdc(
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
): PickVec2 {
  // A zero-sized canvas would divide by zero and hand the raycaster NaN, which
  // it silently treats as "hit nothing" — a readout that simply never appears.
  if (width <= 0 || height <= 0) return { x: 0, y: 0 };
  return {
    x: (offsetX / width) * 2 - 1,
    // DOM Y grows downward, NDC Y grows upward.
    y: -(offsetY / height) * 2 + 1,
  };
}

/**
 * Converts a scene-frame point into the viewport's local frame.
 *
 * Mirrored to match the surface, then recentred — the same composition the
 * surface geometry is baked with, done arithmetically because a single point
 * needs no transform node.
 *
 * @param scene Point in the frame the removal grid was stamped in, in mm.
 * @param originMm Scene-space min corner of the removal grid.
 * @param mesh Surface extents, for the recentring offsets.
 * @returns The point in the viewport's local frame, in mm.
 */
export function localFromScene(
  scene: PickVec3,
  originMm: PickVec2,
  mesh: { readonly widthMm: number; readonly heightMm: number },
): PickVec3 {
  return {
    x: scene.x - originMm.x - mesh.widthMm / 2,
    y: -(scene.y - originMm.y) + mesh.heightMm / 2,
    z: scene.z,
  };
}

/**
 * Converts a viewport-local point back to the frame the grid was stamped in.
 *
 * Exact inverse of the placement in viewer3d-content: mirror in Y, recentre on
 * the mesh, then add the grid origin.
 *
 * @param local Point in the viewport's local frame, in mm.
 * @param originMm Scene-space min corner of the removal grid.
 * @param mesh Surface extents, for the recentring offsets.
 * @returns The point in scene frame, in mm.
 */
export function sceneFromLocal(
  local: PickVec3,
  originMm: PickVec2,
  mesh: { readonly widthMm: number; readonly heightMm: number },
): PickVec3 {
  return {
    x: local.x + mesh.widthMm / 2 + originMm.x,
    y: mesh.heightMm / 2 - local.y + originMm.y,
    z: local.z,
  };
}
