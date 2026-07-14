// textToPolylines — render a TextObject's content into ColoredPath
// polylines via opentype.js. Pure once the font ArrayBuffer is in
// hand (no I/O — the caller owns the fetch).
//
// Algorithm:
//   1. parse the font with opentype.js
//   2. for each line of text:
//        compute the line's pen offsets per character (kerning aware)
//        get the path command stream for the line
//   3. flatten path commands to polylines via De Casteljau (matches
//      the SVG-import sampler so visual fidelity is consistent)
//   4. handle alignment by post-translating each line's polylines
//      so the line's bounding box aligns left/center/right within the
//      max line width
//
// Returns ColoredPath[] — one entry per text color (Phase D has one).
// Polylines are in MILLIMETRES, with the text baseline of the FIRST
// line at y=0 and successive lines below (positive Y is "down" in the
// scene, matching SVG-like convention; the origin transform applies
// later as for any other SceneObject).
//
// Known limitation — RTL scripts (Hebrew, Arabic, N'Ko, etc.) render
// left-to-right rather than right-to-left because opentype.js doesn't
// run the Unicode Bidirectional Algorithm. Glyph shapes are correct,
// only ordering is wrong. Full fix needs a UBA pass (e.g. via the
// `bidi-js` package, MIT) and would also need Arabic shaping for joining
// forms. Out of Phase D scope; tracked as MIT-T5 in AUDIT.md.
//
// Pure-core compliant: no clock, no random, no I/O.
//
// opentype.js is lazy-loaded via dynamic import (A6 audit fix) — the
// ~110 KB minified weight stays out of the initial bundle. Users who
// never open Add Text never download it. We import only types
// statically; the runtime arrives via `await loadOpentype()`.

import type * as opentype from 'opentype.js';
import {
  curveSubpathBounds,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
} from '../scene';
import {
  textOutlineGeometry,
  translateTextOutline,
  type TextOutlineGeometry,
} from './text-outline-path';
import { singleLineTextToPolylines } from './single-line-text';

// Module surface we actually use. Lets the loader narrow the dynamic-
// import result to something callable without a sprawling cast.
type OpentypeModule = {
  readonly parse: (buffer: ArrayBuffer) => opentype.Font;
};

let opentypePromise: Promise<OpentypeModule> | null = null;
async function loadOpentype(): Promise<OpentypeModule> {
  if (opentypePromise === null) {
    opentypePromise = import('opentype.js')
      .then((mod) => {
        // opentype.js publishes both a namespace and a default export
        // depending on bundler; prefer namespace, fall back to default.
        const ns = mod as unknown as OpentypeModule & { default?: OpentypeModule };
        return ns.parse !== undefined ? ns : (ns.default as OpentypeModule);
      })
      .catch((error: unknown) => {
        opentypePromise = null;
        throw error;
      });
  }
  return opentypePromise;
}

// The outline converter preserves native curves and also emits the legacy
// sampled view used by subsystems that have not migrated to curve geometry.
type TextRenderSharedInput = {
  readonly content: string;
  readonly sizeMm: number;
  readonly alignment: 'left' | 'center' | 'right';
  readonly lineHeight: number; // multiplier of sizeMm
  // Letter spacing as a multiplier of sizeMm. Defaults to 0 (natural).
  // Passed straight through to opentype.js's getPath options, which
  // adds spacing × fontSize to each glyph's advance.
  readonly letterSpacing?: number;
  readonly color: string;
};

export type TextRenderInput = TextRenderSharedInput &
  (
    | { readonly geometry?: 'outline'; readonly fontBuffer: ArrayBuffer }
    | { readonly geometry: 'single-line'; readonly fontKey: string }
  );

export type TextRenderResult = {
  readonly paths: ReadonlyArray<ColoredPath>;
  readonly bounds: Bounds;
};

export async function textToPolylines(input: TextRenderInput): Promise<TextRenderResult> {
  if (input.geometry === 'single-line') return singleLineTextToPolylines(input);
  const ot = await loadOpentype();
  const font = ot.parse(input.fontBuffer);
  const lines = input.content.split('\n');
  const lineSpacingMm = input.sizeMm * input.lineHeight;
  const letterSpacing = input.letterSpacing ?? 0;
  // Per-line widths drive alignment. With letterSpacing != 0 the
  // natural advance changes — add (N-1) * spacing × sizeMm per line
  // since opentype's getAdvanceWidth doesn't apply our tracking.
  const lineWidths = lines.map(
    (line) =>
      measureLineWidth(font, line, input.sizeMm) +
      Math.max(0, line.length - 1) * letterSpacing * input.sizeMm,
  );
  const maxWidth = lineWidths.reduce((m, w) => (w > m ? w : m), 0);
  const raw: Polyline[] = [];
  const rawCurves: CurveSubpath[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const lineWidth = lineWidths[i] ?? 0;
    const xOffset = alignOffset(input.alignment, lineWidth, maxWidth);
    const yBaseline = i * lineSpacingMm;
    const geometry = lineGeometry(font, line, input.sizeMm, xOffset, yBaseline, letterSpacing);
    raw.push(...geometry.polylines);
    rawCurves.push(...geometry.curves);
  }
  // Normalize: translate so the natural bounds are (0, 0)-rooted,
  // matching ImportedSvg's viewBox convention. fit-to-bed, hit-test,
  // and the workspace renderer all treat object-local bounds as
  // starting at top-left; text needs to behave the same.
  const { polylines, curves, bounds } = normalizeToOrigin(raw, rawCurves);
  return {
    paths: [{ color: input.color, polylines, curves }],
    bounds,
  };
}

function normalizeToOrigin(
  polylines: ReadonlyArray<Polyline>,
  curves: ReadonlyArray<CurveSubpath>,
): {
  readonly polylines: ReadonlyArray<Polyline>;
  readonly curves: ReadonlyArray<CurveSubpath>;
  readonly bounds: Bounds;
} {
  if (polylines.length === 0) {
    return { polylines: [], curves: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const curve of curves) {
    const curveBounds = curveSubpathBounds(curve);
    minX = Math.min(minX, curveBounds.minX);
    minY = Math.min(minY, curveBounds.minY);
    maxX = Math.max(maxX, curveBounds.maxX);
    maxY = Math.max(maxY, curveBounds.maxY);
  }
  if (!Number.isFinite(minX)) {
    return { polylines: [], curves: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  }
  const dx = -minX;
  const dy = -minY;
  const shifted = translateTextOutline({ polylines, curves }, dx, dy);
  return {
    polylines: shifted.polylines,
    curves: shifted.curves,
    bounds: { minX: 0, minY: 0, maxX: maxX - minX, maxY: maxY - minY },
  };
}

function measureLineWidth(font: opentype.Font, line: string, sizeMm: number): number {
  // opentype's getAdvanceWidth returns the pen advance in font units;
  // multiply by sizeMm/unitsPerEm to convert. Includes kerning.
  return font.getAdvanceWidth(line, sizeMm);
}

function alignOffset(
  alignment: 'left' | 'center' | 'right',
  lineWidth: number,
  maxWidth: number,
): number {
  switch (alignment) {
    case 'left':
      return 0;
    case 'center':
      return (maxWidth - lineWidth) / 2;
    case 'right':
      return maxWidth - lineWidth;
  }
}

function lineGeometry(
  font: opentype.Font,
  line: string,
  sizeMm: number,
  xOffset: number,
  yBaseline: number,
  letterSpacing: number,
): TextOutlineGeometry {
  // opentype's getPath returns SVG-like commands in mm-equivalent
  // units when we pass sizeMm directly. The baseline sits at y = 0
  // by convention; we translate to (xOffset, yBaseline). The
  // letterSpacing option (since opentype.js 1.3) is a multiplier of
  // fontSize added after each glyph's natural advance — opentype's
  // implementation just does `x += options.letterSpacing * fontSize`
  // per char (verified in node_modules/opentype.js source).
  //
  // Features: opentype v2 defaults kerning ON but ships ligatures OFF.
  // We turn liga + rlig on explicitly so "fi" / "fl" and language-
  // required ligatures render as expected — without this, glyphs that
  // a font designs as one shape come out as two separate letters and
  // the user sees a visible regression vs Inkscape / CorelDRAW
  // (MIT-compare audit recommendation).
  const path = font.getPath(line, xOffset, yBaseline, sizeMm, {
    kerning: true,
    letterSpacing,
    features: { liga: true, rlig: true },
  });
  return textOutlineGeometry(path.commands);
}
