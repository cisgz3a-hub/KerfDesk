// viewer3d-clipping — where the section plane sits.
//
// Cutting a pocket open from the front is the fastest way to check a floor
// depth or a wall angle against what was intended. three clips a fragment when
// dot(normal, point) + constant < 0, so all this module owns is turning a
// 0..1 slider position into that constant.
//
// The plane COUNT never changes: the renderer is given a one-element array up
// front and sectioning is switched off by pushing the plane past the far edge,
// not by emptying the array. Changing the array's length recompiles every
// shader in the scene, which stutters exactly while the slider is being
// dragged.
//
// PURE: numbers in, a number out. No three import.

// Normal points along -Y in the viewport's local frame, so the visible half is
// the near side and dragging carves the part open towards the camera.
export const SECTION_PLANE_NORMAL: readonly [number, number, number] = [0, -1, 0];

// A fraction at or above this shows the whole part. Named because both the
// plane maths and the "is sectioning active" test read it.
export const SECTION_DISABLED_FRACTION = 1;

/**
 * Plane constant for a section position.
 *
 * @param fraction 0 hides everything, 1 shows the whole part.
 * @param spanMm The part's extent along the plane normal, in mm.
 * @returns The constant for a plane with SECTION_PLANE_NORMAL.
 */
export function sectionPlaneConstant(fraction: number, spanMm: number): number {
  const clamped = Math.min(1, Math.max(0, fraction));
  // The geometry is recentred on the origin, so it spans -span/2..+span/2.
  // With normal -Y the kept half is y < constant, which sweeps across that
  // range as the fraction goes 0 -> 1.
  return -spanMm / 2 + clamped * spanMm;
}

/**
 * Whether a section fraction actually hides anything.
 *
 * @param fraction The slider position.
 * @returns True when the plane should clip.
 */
export function isSectionActive(fraction: number): boolean {
  return fraction < SECTION_DISABLED_FRACTION;
}
