import type { CurveSubpath, Polyline, StrokeTransform } from './scene-object';

export type ColoredPath = {
  // Lowercase 6-digit source-artwork color, e.g. '#ff0000'. Schema-v3
  // operation bindings are explicit; color remains a legacy fallback.
  readonly color: string;
  readonly operationIds?: ReadonlyArray<string>;
  readonly polylines: ReadonlyArray<Polyline>;
  // Local-coordinate width of a trusted round-stroke source. Ordinary line
  // operations keep the centerline; filled-region CAM may materialize the
  // visible stroke outline without changing laser/engrave geometry.
  readonly strokeWidthMm?: number;
  readonly strokeTransform?: StrokeTransform;
  // Preserve an outlined font's winding semantics after Convert to Path.
  // Absent follows the object's family (text: nonzero; other vectors: evenodd).
  readonly fillRule?: 'nonzero' | 'evenodd';
  // Schema-v2 canonical geometry. `polylines` remains a deterministic
  // compatibility view while preview and compilation migrate subsystem by
  // subsystem; serializers always materialize this field for saved projects.
  readonly curves?: ReadonlyArray<CurveSubpath>;
  // Containment forest of the closed subpaths, written by the contour tracer
  // (ADR-531). Optional and derived: readers use it only through
  // `carriedSubpathParents`, which ignores it once the geometry changes.
  readonly subpathNesting?: SubpathNesting;
};

/** Parent of each subpath (-1 for an outer) plus the key of the geometry it
 *  was computed for (subpath-nesting.ts). A parent always precedes its child. */
export type SubpathNesting = {
  readonly parents: ReadonlyArray<number>;
  readonly geometryKey: string;
};
