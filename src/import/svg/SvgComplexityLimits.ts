/**
 * T2-123: explicit complexity limits at the SVG import entry.
 * Pre-T2-123 the parser had no node-count cap, no recursion-depth
 * bound, no path-token / segment cap, no polygon-point cap. A
 * malicious or pathologically-large SVG could:
 *   - nest <g> 10 000 levels deep → recursion stack exhaustion
 *   - carry a single <path d=""> with 10M commands → multi-GB parse
 *   - contain 1M <rect> elements → multi-GB allocation
 *   - put 50M points in a single <polygon>
 *
 * Audit 5D Critical 7 + Required Priority 7 calls these out as real
 * — bug-bounty reports against drawing apps regularly include "SVG
 * with 10M path commands crashes the renderer." T2-123 ships the
 * limits + the typed `SvgImportLimitError` + check helpers; wiring
 * them into `SvgParser.ts` / `PathParser.ts` is filed as
 * T2-123-followup so the cross-cutting integration lands together.
 */

export const SVG_LIMITS = {
  /** Maximum total bytes accepted (also enforced by T1-92 file gate). */
  MAX_BYTES: 25 * 1024 * 1024,
  /** Maximum total DOM elements visited during traversal. */
  MAX_NODES: 50_000,
  /** Maximum nesting depth (recursion bound for traverse). */
  MAX_DEPTH: 100,
  /** Maximum total renderable shapes — paths, rects, polygons, etc. */
  MAX_RENDERABLE: 10_000,
  /** Maximum tokens (commands + numbers) in a single path's `d`. */
  MAX_PATH_TOKENS: 200_000,
  /** Maximum computed segments per path after parsing. */
  MAX_PATH_SEGMENTS: 100_000,
  /** Maximum points in a single <polygon>/<polyline>. */
  MAX_POLYGON_POINTS: 100_000,
  /** Maximum nested transforms in the active stack. */
  MAX_TRANSFORM_DEPTH: 50,
} as const;

export type SvgLimitKey = keyof typeof SVG_LIMITS;

/**
 * Specific error thrown by the parser when a limit is exceeded.
 * Carries the limit name + observed value so the UI can render a
 * useful message ("This SVG contains 1,247,000 path segments. The
 * maximum supported is 100,000.").
 */
export class SvgImportLimitError extends Error {
  override readonly name = 'SvgImportLimitError';
  readonly limit: SvgLimitKey;
  readonly observed: number;
  readonly maximum: number;

  constructor(limit: SvgLimitKey, observed: number) {
    super(`SVG ${limit} exceeded: observed ${observed}, limit ${SVG_LIMITS[limit]}`);
    this.limit = limit;
    this.observed = observed;
    this.maximum = SVG_LIMITS[limit];
    // Preserve the prototype chain when transpiled to ES5 targets.
    Object.setPrototypeOf(this, SvgImportLimitError.prototype);
  }
}

/**
 * Throws `SvgImportLimitError` when `observed > limit`. The strict
 * `>` comparison lets a value EQUAL to the limit pass — the caller
 * is expected to bump the counter THEN check, so 'observed' is the
 * post-increment value.
 */
export function assertSvgLimit(limit: SvgLimitKey, observed: number): void {
  if (observed > SVG_LIMITS[limit]) {
    throw new SvgImportLimitError(limit, observed);
  }
}

/**
 * Mutable counters carried alongside traversal. Each new <element>
 * bumps `nodeCount`; entering a child bumps `depth` (decrement on
 * exit); each renderable bumps `renderableCount`; each transform
 * matrix multiplication bumps `transformDepth`.
 */
export interface SvgParseContext {
  nodeCount: number;
  renderableCount: number;
  depth: number;
  transformDepth: number;
}

export function emptyParseContext(): SvgParseContext {
  return { nodeCount: 0, renderableCount: 0, depth: 0, transformDepth: 0 };
}

/**
 * Convenience: bump a counter then assert. Returns the new value
 * so callers can inline the increment.
 *   `ctx.nodeCount = bumpAndAssert(ctx.nodeCount, 'MAX_NODES');`
 */
export function bumpAndAssert(value: number, limit: SvgLimitKey): number {
  const next = value + 1;
  assertSvgLimit(limit, next);
  return next;
}

/**
 * User-facing message for an SvgImportLimitError. Mirrors the
 * audit's wording — "This SVG contains N <thing>. The maximum
 * supported is M." Returns a fallback for unknown errors so a
 * caller in a catch block can render something useful regardless.
 */
export function svgLimitErrorMessage(err: unknown): string {
  if (!(err instanceof SvgImportLimitError)) {
    return 'Cannot import SVG: an unexpected error occurred while parsing.';
  }
  const what: Record<SvgLimitKey, string> = {
    MAX_BYTES: 'bytes',
    MAX_NODES: 'XML elements',
    MAX_DEPTH: 'levels of nesting',
    MAX_RENDERABLE: 'shapes',
    MAX_PATH_TOKENS: 'characters in a single <path d="">',
    MAX_PATH_SEGMENTS: 'path segments',
    MAX_POLYGON_POINTS: 'points in a single <polygon>',
    MAX_TRANSFORM_DEPTH: 'nested transforms',
  };
  return (
    `Cannot import SVG: this file contains ${err.observed.toLocaleString()} ` +
    `${what[err.limit]}. The maximum supported is ${err.maximum.toLocaleString()}.`
  );
}
