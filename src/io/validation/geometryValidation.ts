/**
 * T2-75: deep geometry/settings validation on load. Pre-T2-75 the
 * deserializer validated transform finiteness only; geometry shape
 * fields and layer-setting numeric fields could be NaN, Infinity,
 * negative, or absurdly large without being caught. A corrupted but
 * still parseable JSON loaded "successfully" then crashed later
 * during compile/render/preflight — far from the load site, hard
 * to diagnose. Audit 4D Required Priority 9.
 *
 * T2-75 ships the validators + the auto-repair mode + a structured
 * `GeometryValidationIssue` report. The integration with
 * `deserializeScene` (T2-74's repairs collector) is filed as
 * T2-75-followup so each shape's auto-repair behaviour can be
 * reviewed independently.
 */

/**
 * One validation issue. Tagged with `kind` so the UI can render
 * actionable per-issue copy and route auto-repair behaviour.
 */
export type GeometryValidationIssueKind =
  | 'invalid-rect-width' | 'invalid-rect-height' | 'invalid-rect-corner-radius'
  | 'invalid-rect-position'
  | 'invalid-ellipse-rx' | 'invalid-ellipse-ry' | 'invalid-ellipse-center'
  | 'invalid-line-endpoint'
  | 'invalid-polygon-points' | 'invalid-polygon-point-coordinate'
  | 'invalid-text-fontsize' | 'invalid-text-empty'
  | 'invalid-image-dimensions' | 'invalid-image-crop'
  | 'invalid-layer-power' | 'invalid-layer-speed'
  | 'invalid-layer-passes' | 'invalid-layer-fill-interval';

export interface GeometryValidationIssue {
  kind: GeometryValidationIssueKind;
  /** Path inside the scene object — e.g. `geometry.width`. */
  field: string;
  /** What the loader saw before repair. Useful for support diagnostics. */
  observed: unknown;
  /** What auto-repair set the field to. Null in strict mode (no repair). */
  repaired?: unknown;
  /** User-facing summary. */
  message: string;
}

export interface ValidationResult<T> {
  value: T;
  issues: GeometryValidationIssue[];
}

export type ValidationMode = 'auto-repair' | 'strict';

/**
 * Strict-mode failure. Throw at the load site so the user sees the
 * problem immediately rather than during a later compile.
 */
export class GeometryValidationError extends Error {
  override readonly name = 'GeometryValidationError';
  readonly issues: GeometryValidationIssue[];
  constructor(issues: GeometryValidationIssue[]) {
    super(`Geometry validation failed: ${issues.length} issue(s).`);
    this.issues = issues;
    Object.setPrototypeOf(this, GeometryValidationError.prototype);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositive(n: unknown): n is number {
  return isFiniteNumber(n) && n > 0;
}

function isNonNegative(n: unknown): n is number {
  return isFiniteNumber(n) && n >= 0;
}

// ─── per-shape validators ─────────────────────────────────────

interface RectLike { type: 'rect'; x: number; y: number; width: number; height: number; cornerRadius: number; }

export function validateRectGeometry(g: RectLike): ValidationResult<RectLike> {
  const issues: GeometryValidationIssue[] = [];
  const out: RectLike = { ...g };
  if (!isPositive(g.width)) {
    issues.push({
      kind: 'invalid-rect-width',
      field: 'geometry.width',
      observed: g.width,
      repaired: 1,
      message: 'Rectangle width must be positive; defaulted to 1 mm.',
    });
    out.width = 1;
  }
  if (!isPositive(g.height)) {
    issues.push({
      kind: 'invalid-rect-height',
      field: 'geometry.height',
      observed: g.height,
      repaired: 1,
      message: 'Rectangle height must be positive; defaulted to 1 mm.',
    });
    out.height = 1;
  }
  if (!isFiniteNumber(g.x)) {
    issues.push({
      kind: 'invalid-rect-position',
      field: 'geometry.x',
      observed: g.x,
      repaired: 0,
      message: 'Rectangle x is not finite; defaulted to 0.',
    });
    out.x = 0;
  }
  if (!isFiniteNumber(g.y)) {
    issues.push({
      kind: 'invalid-rect-position',
      field: 'geometry.y',
      observed: g.y,
      repaired: 0,
      message: 'Rectangle y is not finite; defaulted to 0.',
    });
    out.y = 0;
  }
  if (!isNonNegative(g.cornerRadius)) {
    issues.push({
      kind: 'invalid-rect-corner-radius',
      field: 'geometry.cornerRadius',
      observed: g.cornerRadius,
      repaired: 0,
      message: 'Rectangle corner radius must be ≥ 0; defaulted to 0.',
    });
    out.cornerRadius = 0;
  }
  return { value: out, issues };
}

interface EllipseLike { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; }

export function validateEllipseGeometry(g: EllipseLike): ValidationResult<EllipseLike> {
  const issues: GeometryValidationIssue[] = [];
  const out: EllipseLike = { ...g };
  if (!isPositive(g.rx)) {
    issues.push({
      kind: 'invalid-ellipse-rx',
      field: 'geometry.rx',
      observed: g.rx,
      repaired: 1,
      message: 'Ellipse rx must be positive; defaulted to 1 mm.',
    });
    out.rx = 1;
  }
  if (!isPositive(g.ry)) {
    issues.push({
      kind: 'invalid-ellipse-ry',
      field: 'geometry.ry',
      observed: g.ry,
      repaired: 1,
      message: 'Ellipse ry must be positive; defaulted to 1 mm.',
    });
    out.ry = 1;
  }
  if (!isFiniteNumber(g.cx) || !isFiniteNumber(g.cy)) {
    issues.push({
      kind: 'invalid-ellipse-center',
      field: 'geometry.cx/cy',
      observed: { cx: g.cx, cy: g.cy },
      repaired: { cx: 0, cy: 0 },
      message: 'Ellipse center is not finite; defaulted to (0, 0).',
    });
    out.cx = isFiniteNumber(g.cx) ? g.cx : 0;
    out.cy = isFiniteNumber(g.cy) ? g.cy : 0;
  }
  return { value: out, issues };
}

interface LineLike { type: 'line'; x1: number; y1: number; x2: number; y2: number; }

export function validateLineGeometry(g: LineLike): ValidationResult<LineLike> {
  const issues: GeometryValidationIssue[] = [];
  const out: LineLike = { ...g };
  for (const k of ['x1', 'y1', 'x2', 'y2'] as const) {
    if (!isFiniteNumber(g[k])) {
      issues.push({
        kind: 'invalid-line-endpoint',
        field: `geometry.${k}`,
        observed: g[k],
        repaired: 0,
        message: `Line endpoint ${k} is not finite; defaulted to 0.`,
      });
      out[k] = 0;
    }
  }
  return { value: out, issues };
}

interface PolygonLike { type: 'polygon'; points: Array<{ x: number; y: number }>; closed: boolean; }

export function validatePolygonGeometry(g: PolygonLike): ValidationResult<PolygonLike> {
  const issues: GeometryValidationIssue[] = [];
  if (!Array.isArray(g.points) || g.points.length < 2) {
    issues.push({
      kind: 'invalid-polygon-points',
      field: 'geometry.points',
      observed: g.points,
      repaired: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      message: 'Polygon needs at least 2 points; defaulted to a single segment.',
    });
    return {
      value: { ...g, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
      issues,
    };
  }
  const cleaned: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < g.points.length; i++) {
    const p = g.points[i];
    if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
      issues.push({
        kind: 'invalid-polygon-point-coordinate',
        field: `geometry.points[${i}]`,
        observed: p,
        repaired: { x: 0, y: 0 },
        message: `Polygon point ${i} has non-finite coordinate; defaulted to (0, 0).`,
      });
      cleaned.push({ x: 0, y: 0 });
    } else {
      cleaned.push({ x: p.x, y: p.y });
    }
  }
  return { value: { ...g, points: cleaned }, issues };
}

interface TextLike { type: 'text'; text: string; fontSize: number; fontFamily: string; }

export function validateTextGeometry<T extends TextLike>(g: T): ValidationResult<T> {
  const issues: GeometryValidationIssue[] = [];
  const out: T = { ...g };
  if (!isPositive(g.fontSize)) {
    issues.push({
      kind: 'invalid-text-fontsize',
      field: 'geometry.fontSize',
      observed: g.fontSize,
      repaired: 10,
      message: 'Text font size must be positive; defaulted to 10 mm.',
    });
    out.fontSize = 10;
  }
  if (typeof g.text !== 'string') {
    issues.push({
      kind: 'invalid-text-empty',
      field: 'geometry.text',
      observed: g.text,
      repaired: '',
      message: 'Text content is not a string; defaulted to empty.',
    });
    out.text = '';
  }
  return { value: out, issues };
}

interface ImageLike {
  type: 'image';
  originalWidth: number;
  originalHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

export function validateImageGeometry<T extends ImageLike>(g: T): ValidationResult<T> {
  const issues: GeometryValidationIssue[] = [];
  const out: T = { ...g };
  if (!isPositive(g.originalWidth) || !isPositive(g.originalHeight)) {
    issues.push({
      kind: 'invalid-image-dimensions',
      field: 'geometry.originalWidth/Height',
      observed: { w: g.originalWidth, h: g.originalHeight },
      repaired: { w: 1, h: 1 },
      message: 'Image dimensions must be positive; defaulted to 1×1.',
    });
    if (!isPositive(g.originalWidth)) out.originalWidth = 1;
    if (!isPositive(g.originalHeight)) out.originalHeight = 1;
  }
  if (!isNonNegative(g.cropX) || !isNonNegative(g.cropY)
      || !isPositive(g.cropWidth) || !isPositive(g.cropHeight)) {
    issues.push({
      kind: 'invalid-image-crop',
      field: 'geometry.crop*',
      observed: { x: g.cropX, y: g.cropY, w: g.cropWidth, h: g.cropHeight },
      repaired: {
        x: 0, y: 0,
        w: out.originalWidth, h: out.originalHeight,
      },
      message: 'Image crop is invalid; defaulted to the full image.',
    });
    out.cropX = 0;
    out.cropY = 0;
    out.cropWidth = out.originalWidth;
    out.cropHeight = out.originalHeight;
  }
  return { value: out, issues };
}

// ─── layer settings ───────────────────────────────────────────

interface LaserSettingsLike {
  power?: { min?: number; max?: number };
  speed?: number;
  passes?: number;
  fill?: { interval?: number };
}

/**
 * Validate the numeric tail of a layer's `settings`. Power/speed are
 * required by JobCompiler; passes default to 1; fill interval (when
 * present) must be positive.
 *
 * Returns the (potentially repaired) settings + issues.
 */
export function validateLayerSettings<T extends LaserSettingsLike>(s: T): ValidationResult<T> {
  const issues: GeometryValidationIssue[] = [];
  const out: T = JSON.parse(JSON.stringify(s));
  // Power
  if (out.power != null) {
    const min = out.power.min;
    const max = out.power.max;
    if (!isFiniteNumber(min) || !isFiniteNumber(max) || min < 0 || max < 0 || min > max) {
      issues.push({
        kind: 'invalid-layer-power',
        field: 'settings.power',
        observed: out.power,
        repaired: { min: 0, max: 100 },
        message: 'Layer power range is invalid; defaulted to 0..100.',
      });
      out.power = { min: 0, max: 100 };
    }
  }
  // Speed
  if (out.speed !== undefined && !isPositive(out.speed)) {
    issues.push({
      kind: 'invalid-layer-speed',
      field: 'settings.speed',
      observed: out.speed,
      repaired: 1000,
      message: 'Layer speed must be positive; defaulted to 1000.',
    });
    out.speed = 1000;
  }
  // Passes
  if (out.passes !== undefined) {
    if (!isFiniteNumber(out.passes) || out.passes < 1 || !Number.isInteger(out.passes)) {
      issues.push({
        kind: 'invalid-layer-passes',
        field: 'settings.passes',
        observed: out.passes,
        repaired: 1,
        message: 'Layer passes must be a positive integer; defaulted to 1.',
      });
      out.passes = 1;
    }
  }
  // Fill interval
  if (out.fill?.interval !== undefined && !isPositive(out.fill.interval)) {
    issues.push({
      kind: 'invalid-layer-fill-interval',
      field: 'settings.fill.interval',
      observed: out.fill.interval,
      repaired: 0.1,
      message: 'Fill interval must be positive; defaulted to 0.1 mm.',
    });
    out.fill = { ...out.fill, interval: 0.1 };
  }
  return { value: out, issues };
}

/**
 * Mode-aware entry: in `'strict'` mode, throws with the issue list
 * when any issue is present; in `'auto-repair'` mode (default),
 * returns the repaired value alongside the issues so the loader can
 * surface them via T2-74's repair report.
 */
export function applyValidationMode<T>(
  result: ValidationResult<T>,
  mode: ValidationMode,
): T {
  if (mode === 'strict' && result.issues.length > 0) {
    throw new GeometryValidationError(result.issues);
  }
  return result.value;
}
