import type { TextBoxSettings } from '../scene/text-box';
// textToPolylines — render a TextObject's content into ColoredPath
// polylines. Outline fonts use opentype.js once their ArrayBuffer is in
// hand; bundled CNC fonts route to their native open-stroke renderer.
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
  type Vec2,
} from '../scene';
import {
  textOutlineGeometry,
  translateTextOutline,
  type TextOutlineGeometry,
} from './text-outline-path';
import { layoutTextBox, type TextBoxLayout } from './text-box-layout';
import { finishTextBoxRender } from './text-box-render';
import { cncStrokeTextToPolylines } from './cnc-stroke-font';
import { missingCharacters, textForLayout } from './glyph-coverage';

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
  readonly textBox?: TextBoxSettings;
};

export type TextRenderInput = TextRenderSharedInput &
  (
    | { readonly geometry?: 'outline'; readonly fontBuffer: ArrayBuffer }
    | { readonly geometry: 'single-line'; readonly fontKey: string }
  );

export type TextRenderResult = {
  readonly textBoxLayout?: TextBoxLayout;
  readonly paths: ReadonlyArray<ColoredPath>;
  readonly bounds: Bounds;
  /**
   * The alignment anchor, in the same frame as `paths` and `bounds`: the
   * point on the first line's baseline where every line starts, centres or
   * ends (left, center or right alignment). Each render re-roots at its own
   * ink top-left, so variable output uses this to keep a changing value
   * where the operator placed it. Absent when the text has no ink, or when
   * bending or path placement reshaped it and no single anchor survives.
   */
  readonly anchor?: Vec2;
  /**
   * Characters the font has no glyph for, once each in reading order: an
   * outline font draws its missing-glyph shape for them (often a box, for
   * some fonts nothing) and a single-line font draws "?". Absent when the
   * font covers the whole text.
   */
  readonly missingCharacters?: ReadonlyArray<string>;
};

export async function textToPolylines(input: TextRenderInput): Promise<TextRenderResult> {
  if (input.geometry === 'single-line') return cncStrokeTextToPolylines(input);
  const ot = await loadOpentype();
  const font = ot.parse(input.fontBuffer);
  const layout =
    input.textBox === undefined
      ? undefined
      : layoutTextBox(
          { ...input, content: textForLayout(input.content), textBox: input.textBox },
          (line, size) => measureLineWidth(font, line, size, input.letterSpacing ?? 0),
          (font.ascender - font.descender) / font.unitsPerEm,
        );
  const actual =
    layout === undefined ? input : { ...input, content: layout.content, sizeMm: layout.sizeMm };
  const text = textForLayout(actual.content);
  const lines = text.split('\n');
  const lineSpacingMm = actual.sizeMm * actual.lineHeight;
  const letterSpacing = actual.letterSpacing ?? 0;
  // Per-line widths drive alignment, so they measure the glyphs as drawn.
  const lineWidths = lines.map((line) =>
    measureLineWidth(font, line, actual.sizeMm, letterSpacing),
  );
  const maxWidth = lineWidths.reduce((m, w) => (w > m ? w : m), 0);
  const raw: Polyline[] = [];
  const rawCurves: CurveSubpath[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const lineWidth = lineWidths[i] ?? 0;
    const xOffset = alignOffset(actual.alignment, lineWidth, maxWidth);
    const yBaseline = i * lineSpacingMm;
    const geometry = lineGeometry(font, line, actual.sizeMm, xOffset, yBaseline, letterSpacing);
    raw.push(...geometry.polylines);
    rawCurves.push(...geometry.curves);
  }
  // Normalize: translate so the natural bounds are (0, 0)-rooted,
  // matching ImportedSvg's viewBox convention. fit-to-bed, hit-test,
  // and the workspace renderer all treat object-local bounds as
  // starting at top-left; text needs to behave the same.
  const { polylines, curves, bounds, offset } = normalizeToOrigin(raw, rawCurves);
  // Where a zero-width line would sit is the point every line aligns to.
  const anchorX = alignOffset(actual.alignment, 0, maxWidth);
  const missing = missingCharacters(text, outlineGlyphCoverage(font));
  const rendered: TextRenderResult = {
    paths: [{ color: actual.color, polylines, curves }],
    bounds,
    ...(offset === null ? {} : { anchor: { x: anchorX + offset.x, y: offset.y } }),
    ...(missing.length === 0 ? {} : { missingCharacters: missing }),
  };
  return layout === undefined || input.textBox === undefined
    ? rendered
    : finishTextBoxRender(rendered, layout, input.textBox, input.alignment);
}

/** The characters of `content` an outline font has no glyph for, as its render reports them. */
export async function outlineFontMissingCharacters(
  fontBuffer: ArrayBuffer,
  content: string,
): Promise<ReadonlyArray<string>> {
  const font = (await loadOpentype()).parse(fontBuffer);
  return missingCharacters(textForLayout(content), outlineGlyphCoverage(font));
}

function outlineGlyphCoverage(font: opentype.Font): (character: string) => boolean {
  // Glyph 0 is .notdef, which opentype.js draws for any unmapped character.
  return (character) => font.charToGlyphIndex(character) > 0;
}

function normalizeToOrigin(
  polylines: ReadonlyArray<Polyline>,
  curves: ReadonlyArray<CurveSubpath>,
): {
  readonly polylines: ReadonlyArray<Polyline>;
  readonly curves: ReadonlyArray<CurveSubpath>;
  readonly bounds: Bounds;
  // The translation applied to the layout, or null when there was no ink.
  readonly offset: Vec2 | null;
} {
  if (polylines.length === 0) {
    return {
      polylines: [],
      curves: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      offset: null,
    };
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
    return {
      polylines: [],
      curves: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      offset: null,
    };
  }
  const dx = -minX;
  const dy = -minY;
  const shifted = translateTextOutline({ polylines, curves }, dx, dy);
  return {
    polylines: shifted.polylines,
    curves: shifted.curves,
    bounds: { minX: 0, minY: 0, maxX: maxX - minX, maxY: maxY - minY },
    offset: { x: dx, y: dy },
  };
}

// Ligatures and kerning as lineGeometry draws them. Measured without them, a
// line with "ffi" or "fl" was aligned as if it were wider than drawn.
const SHAPING_OPTIONS = { kerning: true, features: { liga: true, rlig: true } } as const;

function measureLineWidth(
  font: opentype.Font,
  line: string,
  sizeMm: number,
  letterSpacing: number,
): number {
  // The pen advance of the shaped glyphs, kerning included, in mm. Tracking
  // falls between glyphs, so a ligature is one glyph and the line's last
  // glyph adds no trailing gap.
  let glyphs = 0;
  const advance = font.forEachGlyph(line, 0, 0, sizeMm, SHAPING_OPTIONS, () => {
    glyphs += 1;
  });
  return advance + Math.max(0, glyphs - 1) * letterSpacing * sizeMm;
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
    ...SHAPING_OPTIONS,
    letterSpacing,
  });
  return textOutlineGeometry(path.commands);
}
