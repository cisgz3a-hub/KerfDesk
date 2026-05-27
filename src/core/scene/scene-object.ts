// SceneObject — the discriminated union the rest of the pipeline pattern-matches
// against. Phase A ships one variant (ImportedSvg); ADR-014 commits to adding
// 'text' (Phase D) and 'traced-image' (Phase E) without touching code outside
// this module's switch arms. `assertNever` enforces exhaustiveness at compile
// time so the missing arm is the only compile error when a new variant lands.

export type Vec2 = { readonly x: number; readonly y: number };

export type Polyline = {
  readonly points: ReadonlyArray<Vec2>;
  readonly closed: boolean;
};

export type ColoredPath = {
  // Lowercase 6-digit hex color, e.g. '#ff0000'. Layers are keyed by this value.
  readonly color: string;
  readonly polylines: ReadonlyArray<Polyline>;
};

export type Transform = {
  readonly x: number; // mm offset
  readonly y: number; // mm offset
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotationDeg: number; // 0..360
  readonly mirrorX: boolean;
  readonly mirrorY: boolean;
};

export const IDENTITY_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotationDeg: 0,
  mirrorX: false,
  mirrorY: false,
};

export type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type ImportedSvg = {
  readonly kind: 'imported-svg';
  readonly id: string;
  readonly source: string; // filename for display (e.g. 'logo.svg')
  readonly bounds: Bounds; // natural bounds in mm, derived from the viewBox
  readonly transform: Transform;
  readonly paths: ReadonlyArray<ColoredPath>;
};

// Single variant in Phase A. Future variants land here:
//   | { readonly kind: 'text'; ... }        // Phase D — ADR-012
//   | { readonly kind: 'traced-image'; ... } // Phase E — ADR-013
export type SceneObject = ImportedSvg;

// Exhaustiveness helper. Place in the default arm of every `switch` over a
// discriminated union so adding a variant produces exactly one TS error (the
// missing arm). The `label` parameter shapes the runtime error message; pass
// the union's name to make stack traces readable.
export function assertNever(value: never, label = 'union variant'): never {
  throw new Error(`Unhandled ${label}: ${JSON.stringify(value)}`);
}
