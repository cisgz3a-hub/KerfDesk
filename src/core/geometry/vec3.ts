// Vec3 — a point in 3D machine space (mm). XY match the scene/machine
// coordinates used everywhere else; Z follows the CNC convention from
// ADR-094: 0 = stock top, negative = into the stock.
//
// Structurally a superset of scene's Vec2 ({ x, y }), so a Vec3 is
// assignable wherever only XY is read (bounds, 2D preview projection).

export type Vec3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};
