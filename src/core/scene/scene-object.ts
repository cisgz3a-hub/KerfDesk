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

// Text variant added in Phase D (ADR-012). Kept inline here (alongside
// ImportedSvg) so the SceneObject union remains the single source of
// truth — every variant's full shape is in one file. The font
// registry + opentype rendering pipeline live in core/text/ and
// reference TextObject FROM here, not the other way around (avoids a
// circular dependency).
export type TextAlignment = 'left' | 'center' | 'right';

// The string-keyed font identifier. Concrete keys are enumerated in
// core/text/font-registry.ts; this module stays unaware of which
// fonts are bundled (so adding a font doesn't ripple here).
export type FontKey = string;

export type TextObject = {
  readonly kind: 'text';
  readonly id: string;
  readonly content: string;
  readonly fontKey: FontKey;
  readonly sizeMm: number;
  readonly alignment: TextAlignment;
  readonly lineHeight: number; // multiplier of sizeMm
  readonly color: string; // hex; default black
  readonly bounds: Bounds; // computed at edit time from `paths`
  readonly transform: Transform;
  // Pre-rendered polylines. Set when the text is created/edited by
  // calling `textToPolylines` in the UI layer (opentype.js needs the
  // font ArrayBuffer, which is a UI-layer concern). compileJob then
  // iterates these like it does for an ImportedSvg — single code
  // path for both variants once they're materialized.
  readonly paths: ReadonlyArray<ColoredPath>;
};

// Phase D union expansion (ADR-014). Phase E adds 'traced-image'.
export type SceneObject = ImportedSvg | TextObject;

// Exhaustiveness helper. Place in the default arm of every `switch` over a
// discriminated union so adding a variant produces exactly one TS error (the
// missing arm). The `label` parameter shapes the runtime error message; pass
// the union's name to make stack traces readable.
export function assertNever(value: never, label = 'union variant'): never {
  throw new Error(`Unhandled ${label}: ${JSON.stringify(value)}`);
}
