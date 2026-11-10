// Vec3 — a point in 3D machine space (mm). XY match the scene/machine
// coordinates used everywhere else; Z follows the CNC convention from
// ADR-098: 0 = stock top, negative = into the stock.
//
// Structurally a superset of scene's Vec2 ({ x, y }), so a Vec3 is
// assignable wherever only XY is read (bounds, 2D preview projection).

export type Vec3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/** Straight-line distance between two 3D points. */
export function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** The 3D point a fraction `t` of the way from `a` to `b`. */
export function lerp3(a: Vec3, b: Vec3, t: number): { x: number; y: number; z: number } {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
