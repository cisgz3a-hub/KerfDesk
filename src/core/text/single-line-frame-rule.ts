import type { TextObject } from '../scene';
import type { TextBoxSettings } from '../scene/text-box';
import { CNC_STROKE_FONT_DATA } from './cnc-stroke-font-data';
import { fairStrokeFont, isPolylineDigitizedFont } from './fair-stroke-font';
import { renderStrokeFontText, type StrokeFont } from './stroke-font-text';
import { svgStrokeFont } from './svg-stroke-font';
import { styledTextContent, styleTextRender } from './text-style';
import type { TextRenderResult } from './text-to-polylines';

// A file 1.0.28 converted and saved lost the frame's old line rule, and the
// project loader is synchronous, so this reads the stroke fonts directly rather
// than through the renderer's dynamic import (ADR-682 Amendment 3).

/** What writers before schema 19 scaled each single-line font by, in font units. */
export const LEGACY_SIZE_UNITS: ReadonlyMap<string, number> = new Map([
  ['relief-single-line', 680],
  ['ems-nixish', 500],
  ['ems-decorous-script', 500],
  ['ems-casual-hand', 500],
]);
export const UNITS_PER_EM = 1000;

// Stored geometry differs from a fresh render only by rounding, far below this.
const SAME_GEOMETRY_MM = 1e-3;

export type SingleLineFrameText = Pick<
  TextObject,
  'content' | 'fontKey' | 'sizeMm' | 'alignment' | 'lineHeight' | 'letterSpacing' | 'color'
> & {
  readonly textStyle?: TextObject['textStyle'];
  readonly textBox: TextBoxSettings;
};

export type FrameInkSize = { readonly widthMm: number; readonly heightMm: number };

/**
 * `em` and `legacy` name the rule that drew the stored geometry. `either` means
 * the file cannot say: both rules draw the same thing, or neither draws what is
 * stored.
 */
export type StoredFrameRule = 'em' | 'legacy' | 'either';

/** Only a fixed shrink-to-fit frame on a single-line font fits by the line rule. */
export function frameFitsByLineRule(fontKey: string, box: TextBoxSettings): boolean {
  return LEGACY_SIZE_UNITS.has(fontKey) && box.mode === 'fixed' && box.fit === 'shrink';
}

export function legacyLineEmOf(fontKey: string): number | undefined {
  const units = LEGACY_SIZE_UNITS.get(fontKey);
  return units === undefined ? undefined : units / UNITS_PER_EM;
}

export function storedFrameRule(
  text: SingleLineFrameText,
  stored: FrameInkSize & { readonly paths: unknown },
): StoredFrameRule {
  const font = strokeFont(text.fontKey);
  const legacyLineEm = legacyLineEmOf(text.fontKey);
  if (font === null || legacyLineEm === undefined) return 'either';
  const { legacyLineEm: _kept, ...box } = text.textBox;
  const em = renderFrame(text, text.content, box, font);
  const legacy = renderFrame(text, text.content, { ...box, legacyLineEm }, font);
  if (!sameSize(inkSize(em), inkSize(legacy))) {
    if (sameSize(stored, inkSize(em))) return 'em';
    return sameSize(stored, inkSize(legacy)) ? 'legacy' : 'either';
  }
  // Ink that fills the frame's height scales to the same shape under both rules,
  // but from a different trial size, so the two renders part in their last digits.
  // An EMS conversion doubles Size exactly, which leaves the stored points the old
  // rule's to the last bit. No match here only widens the warning.
  const emPoints = pointNumbers(em.paths);
  const legacyPoints = pointNumbers(legacy.paths);
  const storedPoints = pointNumbers(stored.paths);
  if (sameNumbers(emPoints, legacyPoints)) return 'either';
  if (sameNumbers(storedPoints, legacyPoints)) return 'legacy';
  return sameNumbers(storedPoints, emPoints) ? 'em' : 'either';
}

// Stored paths come straight from the file, so nothing about their shape is assumed.
function pointNumbers(paths: unknown): ReadonlyArray<unknown> {
  if (!Array.isArray(paths)) return [];
  return paths.flatMap((path) => {
    const polylines = (path as { readonly polylines?: unknown } | null)?.polylines;
    if (!Array.isArray(polylines)) return [];
    return polylines.flatMap((polyline) => {
      const points = (polyline as { readonly points?: unknown } | null)?.points;
      if (!Array.isArray(points)) return [];
      return points.flatMap((point) => {
        const { x, y } = (point ?? {}) as { readonly x?: unknown; readonly y?: unknown };
        return [x, y];
      });
    });
  });
}

function sameNumbers(left: ReadonlyArray<unknown>, right: ReadonlyArray<unknown>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** The ink one content takes in the frame under each rule; null off the bundled fonts. */
export function frameInkSizes(
  text: SingleLineFrameText,
  content: string,
): { readonly em: FrameInkSize; readonly legacy: FrameInkSize } | null {
  const font = strokeFont(text.fontKey);
  const legacyLineEm = legacyLineEmOf(text.fontKey);
  if (font === null || legacyLineEm === undefined) return null;
  const { legacyLineEm: _kept, ...box } = text.textBox;
  return {
    em: inkSize(renderFrame(text, content, box, font)),
    legacy: inkSize(renderFrame(text, content, { ...box, legacyLineEm }, font)),
  };
}

export function sameSize(left: FrameInkSize, right: FrameInkSize): boolean {
  return (
    Math.abs(left.widthMm - right.widthMm) <= SAME_GEOMETRY_MM &&
    Math.abs(left.heightMm - right.heightMm) <= SAME_GEOMETRY_MM
  );
}

function renderFrame(
  text: SingleLineFrameText,
  content: string,
  textBox: TextBoxSettings,
  font: StrokeFont,
): TextRenderResult {
  return styleTextRender(
    renderStrokeFontText(
      {
        content: styledTextContent(content, text.textStyle),
        sizeMm: text.sizeMm,
        alignment: text.alignment,
        lineHeight: text.lineHeight,
        letterSpacing: text.letterSpacing,
        color: text.color,
        textBox,
      },
      font,
    ),
    text.textStyle,
    text.sizeMm,
  );
}

function inkSize(rendered: TextRenderResult): FrameInkSize {
  return {
    widthMm: rendered.bounds.maxX - rendered.bounds.minX,
    heightMm: rendered.bounds.maxY - rendered.bounds.minY,
  };
}

const fonts = new Map<string, StrokeFont>();

function strokeFont(fontKey: string): StrokeFont | null {
  const cached = fonts.get(fontKey);
  if (cached !== undefined) return cached;
  const source = CNC_STROKE_FONT_DATA.find((font) => font.key === fontKey);
  if (source === undefined) return null;
  const native = svgStrokeFont(source);
  const compiled = isPolylineDigitizedFont(fontKey) ? fairStrokeFont(native) : native;
  fonts.set(fontKey, compiled);
  return compiled;
}
