import type { CurveSubpath, PathSegment, Vec2 } from '../scene';
import type { StrokeFontGlyph } from './stroke-font-text';

const CAP_HEIGHT = 89;

export type ForgeVariant =
  | 'compact'
  | 'sign'
  | 'swing'
  | 'grace'
  | 'signature'
  | 'romantic'
  | 'copperplate'
  | 'casual'
  | 'friendly'
  | 'signwriter'
  | 'parisian'
  | 'personal';

type VariantMetrics = {
  readonly advanceScale: number;
  readonly slant: number;
  readonly xScale: number;
  readonly yScale: number;
  readonly wave?: number;
};

const SCRIPT_METRICS: Readonly<Record<ForgeVariant, VariantMetrics>> = {
  compact: { advanceScale: 0.72, slant: 0, xScale: 0.68, yScale: 1 },
  sign: { advanceScale: 1.14, slant: 0, xScale: 1.1, yScale: 1 },
  swing: { advanceScale: 1, slant: 0.1, xScale: 1, yScale: 1 },
  grace: { advanceScale: 0.88, slant: 0.3, xScale: 0.88, yScale: 1 },
  signature: { advanceScale: 0.92, slant: 0.14, xScale: 0.92, yScale: 0.94 },
  romantic: { advanceScale: 1.05, slant: 0.24, xScale: 1.05, yScale: 1.08 },
  copperplate: { advanceScale: 0.82, slant: 0.2, xScale: 0.82, yScale: 1.06 },
  casual: { advanceScale: 1.05, slant: 0.02, xScale: 1.05, yScale: 0.88, wave: 1.8 },
  friendly: { advanceScale: 1.12, slant: 0.07, xScale: 1.12, yScale: 0.9 },
  signwriter: { advanceScale: 1.18, slant: 0.08, xScale: 1.18, yScale: 0.95 },
  parisian: { advanceScale: 0.8, slant: 0.25, xScale: 0.8, yScale: 1.02 },
  personal: { advanceScale: 0.98, slant: 0.12, xScale: 0.98, yScale: 0.92, wave: 1.2 },
};

export const SWING_OVERRIDES = {
  M: {
    advance: 105,
    path: 'M-10 85 C6 78 10 43 18 13 C23 -5 33 2 31 20 C29 39 21 63 18 79 M18 20 C31 43 39 58 44 78 C52 53 61 29 71 17 C81 5 85 20 80 39 C74 61 70 75 90 78 C96 79 101 78 105 76',
  },
  C: {
    advance: 94,
    path: 'M88 25 C77 4 44 5 24 25 C3 46 1 79 20 94 C39 110 66 96 75 80 M-8 84 C5 81 13 73 20 62',
  },
  S: {
    advance: 82,
    path: 'M76 20 C64 4 37 6 22 22 C8 37 19 50 39 57 C59 64 68 74 60 88 C51 104 25 101 10 87 M-8 84 C2 82 8 78 14 72',
  },
  '&': {
    advance: 82,
    path: 'M64 82 C51 96 25 96 15 80 C6 66 17 54 32 46 C48 37 55 25 48 17 C41 8 26 14 25 27 C24 44 47 63 62 77 C69 84 75 86 82 82 M62 51 C57 67 48 81 37 91',
  },
} as const;

export function transformForgeVariant(
  source: ReadonlyMap<string, StrokeFontGlyph>,
  variant: ForgeVariant,
): Map<string, StrokeFontGlyph> {
  const point = variantPoint(variant);
  const advanceScale = SCRIPT_METRICS[variant].advanceScale;
  return new Map(
    Array.from(source, ([character, glyph]) => [
      character,
      {
        advance: glyph.advance * advanceScale,
        paths: glyph.paths.map((path) => transformPath(path, point)),
      },
    ]),
  );
}

function variantPoint(variant: ForgeVariant): (value: Vec2) => Vec2 {
  const metrics = SCRIPT_METRICS[variant];
  return (point) => {
    const centeredY = point.y - CAP_HEIGHT;
    const y = CAP_HEIGHT + centeredY * metrics.yScale;
    const wave = metrics.wave === undefined ? 0 : Math.sin((point.y - 78) * 0.075) * metrics.wave;
    return {
      x: point.x * metrics.xScale + (CAP_HEIGHT - point.y) * metrics.slant,
      y: y + wave,
    };
  };
}

function transformPath(path: CurveSubpath, point: (value: Vec2) => Vec2): CurveSubpath {
  return {
    ...path,
    start: point(path.start),
    segments: path.segments.map((segment): PathSegment => {
      if (segment.kind === 'line') return { ...segment, to: point(segment.to) };
      if (segment.kind === 'cubic') {
        return {
          ...segment,
          control1: point(segment.control1),
          control2: point(segment.control2),
          to: point(segment.to),
        };
      }
      return { ...segment, to: point(segment.to) };
    }),
  };
}
