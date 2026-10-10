import type { MovePoint } from './heightmap-surface-contact-move';

/**
 * Exact contact heights for one heightmap and one cutter envelope: against the
 * piecewise-linear surface through its samples (ADR-412) or, for a mesh relief,
 * against the mesh's own triangles (ADR-579).
 */
export type SurfaceContactField = {
  /**
   * The highest tip depth at which the cutter centred on sample (cx, cy)
   * touches the surface, or `lowerBound` when nothing requires more. Never
   * lower than `lowerBound`.
   */
  readonly constraint: (cx: number, cy: number, lowerBound: number) => number;
  /**
   * The same contact for a cutter centred anywhere, (x, y) in map mm: waterline
   * finishing places its vertices between samples (ADR-423).
   */
  readonly constraintAtPoint: (x: number, y: number, lowerBound: number) => number;
  /**
   * Whether a cutter centred at (x, y) may stand with its tip at z: its
   * contact there is at most z + slackMm. It stops at the first element found
   * to lift the tip higher, so a "no" costs less than a height (ADR-423).
   */
  readonly clearsAtPoint: (x: number, y: number, z: number, slackMm: number) => boolean;
  /**
   * The contact that can matter along the straight move from `from` to `to`:
   * null when nothing can lift the tip more than `toleranceMm` above the move
   * anywhere on it, else constraintAtPoint over only the elements that might,
   * exact wherever the contact rises further above the move. The answer holds
   * until the next call (ADR-421 Amendment 1).
   */
  readonly alongMove: (
    from: MovePoint,
    to: MovePoint,
    toleranceMm: number,
  ) => ((x: number, y: number, lowerBound: number) => number) | null;
};
