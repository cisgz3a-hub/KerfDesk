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

export type ObjectOperationOverride = {
  readonly mode?: 'line' | 'fill' | 'image';
  readonly minPower?: number;
  readonly power?: number;
  readonly speed?: number;
  readonly passes?: number;
  readonly airAssist?: boolean;
  readonly kerfOffsetMm?: number;
  readonly tabsEnabled?: boolean;
  readonly tabSizeMm?: number;
  readonly tabsPerShape?: number;
  readonly tabSkipInnerShapes?: boolean;
  readonly hatchAngleDeg?: number;
  readonly hatchSpacingMm?: number;
  readonly fillOverscanMm?: number;
  readonly fillStyle?: 'scanline' | 'offset' | 'island';
  readonly fillBidirectional?: boolean;
  readonly fillCrossHatch?: boolean;
  readonly ditherAlgorithm?: DitherAlgorithm;
  readonly linesPerMm?: number;
  readonly imageBidirectional?: boolean;
  readonly negativeImage?: boolean;
  readonly passThrough?: boolean;
  readonly dotWidthCorrectionMm?: number;
};

export type ObjectPowerScale = {
  // LightBurn Shape Properties: per-shape scale applied to layer power.
  readonly powerScale?: number;
  // Optional per-object operation settings. Missing fields inherit the object's
  // assigned layer settings, so layers remain the batch/default control.
  readonly operationOverride?: ObjectOperationOverride;
  // Object locking V1: locked artwork is skipped by normal selection and
  // transform tools, but still renders and compiles.
  readonly locked?: boolean;
};

export type ImportedSvg = ObjectPowerScale & {
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

export type TextObject = ObjectPowerScale & {
  readonly kind: 'text';
  readonly id: string;
  readonly content: string;
  readonly fontKey: FontKey;
  readonly sizeMm: number;
  readonly alignment: TextAlignment;
  readonly lineHeight: number; // multiplier of sizeMm
  // Letter spacing (tracking) as a multiplier of sizeMm. 0 = font's
  // natural spacing. Positive = wider, negative = tighter. opentype.js
  // applies this as an extra advance after each glyph. Phase D.1 add.
  readonly letterSpacing: number;
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

// Traced raster image, Phase E (ADR-013). Same shape pattern as
// TextObject — the raster is pre-traced (via imagetracerjs +
// parseSvg) at import time and the polylines are stored on the
// object. compileJob iterates `paths` like any other variant.
// The `source` field carries the original filename for display.
export type TracedImage = ObjectPowerScale & {
  readonly kind: 'traced-image';
  readonly id: string;
  readonly source: string;
  readonly traceSourceId?: string;
  // Missing means legacy filled-contour trace.
  readonly traceMode?: 'filled-contours' | 'centerline' | 'edge';
  readonly bounds: Bounds;
  readonly transform: Transform;
  readonly paths: ReadonlyArray<ColoredPath>;
};

// Raster image for image-mode engraving, Phase F.2 (ADR-020).
// Unlike TracedImage (which is vectorized at import time and burns
// as outlines), RasterImage retains its pixel data so the compile
// path can dither + emit per-pixel S-modulation G-code.
//
// dataUrl carries PNG bytes embedded in the .lf2 file as a data URL
// (per ADR-020 — self-contained projects). pixelWidth/pixelHeight
// are the source bitmap dimensions; bounds is its placement in mm
// on the workspace.
//
// `dither` and `linesPerMm` are layer-mode-specific knobs typically
// surfaced via the Image-mode layer fields, but stored on the
// object so each image carries its own preferred quality settings
// across save/load.
export const DITHER_ALGORITHMS = [
  'threshold',
  'floyd-steinberg',
  'jarvis',
  'stucki',
  'atkinson',
  'burkes',
  'sierra3',
  'sierra2',
  'sierra-lite',
  'ordered',
  'grayscale',
] as const;

export type DitherAlgorithm = (typeof DITHER_ALGORITHMS)[number];

export type RasterImage = ObjectPowerScale & {
  readonly kind: 'raster-image';
  readonly id: string;
  readonly source: string;
  readonly dataUrl: string; // 'data:image/png;base64,...'
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly bounds: Bounds;
  readonly transform: Transform;
  // The Layer this image binds to, by color key. Lets a single
  // RasterImage reuse the same color/mode/power/speed plumbing as
  // every other SceneObject. Fresh imports land on a canonical
  // image-mode layer (created if missing) so the operator gets a
  // working Image layer auto-configured. The user can re-assign
  // by changing this color (or via a future "Move to layer..." UI).
  readonly color: string;
  readonly dither: DitherAlgorithm;
  // Engraving resolution. 5-25 typical for diode lasers; above 20
  // strains USB bandwidth and pushes G-code past ~1 MB on a
  // 100×100 mm image.
  readonly linesPerMm: number;
  readonly brightness?: number; // -100..100; image engrave adjustment, default 0
  readonly contrast?: number; // -100..100; image engrave adjustment, default 0
  readonly gamma?: number; // 0.1..5; image engrave adjustment, default 1
  // Non-destructive Apply Mask to Image. The referenced scene object remains
  // editable; raster processing whites pixels outside its closed geometry.
  readonly imageMaskId?: string;
  // Pre-extracted greyscale luma buffer (one byte per pixel, ITU-R
  // BT.601: 0.299·R + 0.587·G + 0.114·B), base64-encoded so it can
  // round-trip through .lf2's JSON. Length after decode equals
  // pixelWidth * pixelHeight. Optional because pre-F.2.e .lf2 files
  // didn't have it; compileJob treats missing data as all-white
  // (laser off). UI's image import path is responsible for
  // populating it from the decoded ImageData.
  readonly lumaBase64?: string;
  // ADR-026 render-only marker. When this raster is the source bitmap
  // kept *behind* a trace (the backing you delete once the vector looks
  // right), it's tagged 'trace-source' so the canvas renders it with a
  // tint — the visual cue that there are two stacked layers and which
  // one to remove. Standalone Engrave-Image rasters leave it unset and
  // render normally. Optional + additive: pre-ADR-026 .lf2 files simply
  // lack it (no schemaVersion bump, no migration — same pattern as
  // letterSpacing). Affects display only; never the compiled G-code.
  readonly role?: 'trace-source';
};

// Canonical Layer color for fresh RasterImage imports. Mid-grey is
// the conventional "image" indicator in CAM tools (LightBurn uses
// black, but black collides with line-art SVG imports). 808080 is
// distinct from primary colors and likely-unused so it won't
// accidentally collide with a real layer the user created.
export const DEFAULT_RASTER_LAYER_COLOR = '#808080';

// Drawing-primitive shape, Phase G (ADR-051). Unlike imported geometry, a shape
// is created on-canvas from a parametric block (kind:'rect' for now; ellipse /
// polygon / polyline follow in later increments). `paths` is the materialized
// outline; editing the block re-materializes it. compileJob / preview / emit
// iterate `paths` like every other variant, so nothing downstream changes.
export type RectangleShape = {
  readonly kind: 'rect';
  readonly widthMm: number;
  readonly heightMm: number;
  readonly cornerRadiusMm: number;
};

export type EllipseShape = {
  readonly kind: 'ellipse';
  readonly widthMm: number;
  readonly heightMm: number;
};

export type PolygonShape = {
  readonly kind: 'polygon';
  readonly sides: number; // circumscribed regular polygon, 3..64
  readonly radiusMm: number; // circumradius
};

export type StarShape = {
  readonly kind: 'star';
  readonly points: number; // alternating outer/inner vertices, 3..64 points
  readonly outerRadiusMm: number;
  readonly innerRadiusRatio: number; // innerRadiusMm / outerRadiusMm, 0..1
};

// An open or closed run of points — the pen tool's freeform primitive (B6).
// The points are absolute (the factory places them at IDENTITY_TRANSFORM).
export type PolylineShape = {
  readonly kind: 'polyline';
  readonly points: ReadonlyArray<Vec2>;
  readonly closed: boolean;
};

// The parametric block.
export type ShapeSpec = RectangleShape | EllipseShape | PolygonShape | StarShape | PolylineShape;

export type ShapeObject = ObjectPowerScale & {
  readonly kind: 'shape';
  readonly id: string;
  readonly spec: ShapeSpec;
  readonly color: string; // lowercase hex; the layer key, like TextObject
  readonly bounds: Bounds; // local-space bounds of the materialized outline
  readonly transform: Transform;
  readonly paths: ReadonlyArray<ColoredPath>;
};

// 3D relief for CNC carving, Phase H.4 (ADR-094). Carries the parsed
// triangle mesh as plain numbers (9 per triangle, file order) so the pure
// core compiler can rebuild the heightmap without any decode API, and .lf2
// round-trips it as ordinary JSON (RasterImage's embedded-source precedent).
// targetWidthMm scales the mesh's XY footprint; reliefDepthMm maps its Z
// range to [−depth, 0]; emptyCells picks the background: 'floor' carves it
// away so the model stands proud, 'top' leaves it at stock height. Laser
// mode ignores relief objects entirely (CNC-only geometry).
export type ReliefObject = ObjectPowerScale & {
  readonly kind: 'relief';
  readonly id: string;
  readonly source: string; // filename for display
  readonly meshPositions: ReadonlyArray<number>;
  readonly targetWidthMm: number;
  readonly reliefDepthMm: number;
  readonly emptyCells: 'floor' | 'top';
  readonly color: string; // lowercase hex; the layer key
  readonly bounds: Bounds; // natural bounds: (0,0)..(targetWidth, height by aspect)
  readonly transform: Transform;
};

// Embedding cap: meshes beyond this bloat the .lf2 JSON into the hundreds of
// MB. Decorative reliefs are typically well under it; the import path tells
// the user to decimate when over.
export const RELIEF_EMBED_TRIANGLE_LIMIT = 200_000;

// Full union expanded through Phase G (ADR-014, ADR-020, ADR-051) and
// Phase H (ADR-094). Future variants require an ADR + a PROJECT.md scope
// revision.
export type SceneObject =
  | ImportedSvg
  | TextObject
  | TracedImage
  | RasterImage
  | ShapeObject
  | ReliefObject;

export function sceneObjectPrimaryLayerColor(object: SceneObject): string | null {
  switch (object.kind) {
    case 'raster-image':
    case 'relief':
    case 'shape':
    case 'text':
      return object.color;
    case 'imported-svg':
    case 'traced-image':
      return object.paths[0]?.color ?? null;
    default:
      return assertNever(object);
  }
}

export function sceneObjectUsesLayerColor(object: SceneObject, color: string): boolean {
  switch (object.kind) {
    case 'raster-image':
    case 'relief':
    case 'shape':
    case 'text':
      return object.color === color;
    case 'imported-svg':
    case 'traced-image':
      return object.paths.some((path) => path.color === color);
    default:
      return assertNever(object);
  }
}

// Exhaustiveness helper. Place in the default arm of every `switch` over a
// discriminated union so adding a variant produces exactly one TS error (the
// missing arm). The `label` parameter shapes the runtime error message; pass
// the union's name to make stack traces readable.
export function assertNever(value: never, label = 'union variant'): never {
  throw new Error(`Unhandled ${label}: ${JSON.stringify(value)}`);
}
