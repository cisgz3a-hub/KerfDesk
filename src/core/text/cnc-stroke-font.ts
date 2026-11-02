import { fairStrokeFont, isPolylineDigitizedFont } from './fair-stroke-font';
import { missingCharacters, textForLayout, withoutBidiControls } from './glyph-coverage';
import {
  renderStrokeFontText,
  type StrokeFont,
  type StrokeTextRenderInput,
} from './stroke-font-text';
import { svgStrokeFont } from './svg-stroke-font';
import type { TextRenderResult } from './text-to-polylines';

const fontCache = new Map<string, StrokeFont>();

export type CncStrokeTextRenderInput = StrokeTextRenderInput & {
  readonly fontKey: string;
};

/** Renders a bundled OFL CNC face as its native open machining strokes. */
export async function cncStrokeTextToPolylines(
  input: CncStrokeTextRenderInput,
): Promise<TextRenderResult> {
  return renderStrokeFontText(input, await loadCncStrokeFont(input.fontKey));
}

/** The characters of `content` a CNC face has no stroke for, as its render reports them. */
export async function cncStrokeFontMissingCharacters(
  fontKey: string,
  content: string,
): Promise<ReadonlyArray<string>> {
  const font = await loadCncStrokeFont(fontKey);
  return missingCharacters(textForLayout(withoutBidiControls(content)), (character) =>
    font.glyphs.has(character),
  );
}

async function loadCncStrokeFont(fontKey: string): Promise<StrokeFont> {
  const cached = fontCache.get(fontKey);
  if (cached !== undefined) return cached;
  const { CNC_STROKE_FONT_DATA } = await import('./cnc-stroke-font-data');
  const source = CNC_STROKE_FONT_DATA.find((font) => font.key === fontKey);
  if (source === undefined) throw new Error(`Unsupported CNC single-line font "${fontKey}".`);
  const native = svgStrokeFont(source);
  // EMS faces are line-chain digitized; fair them into smooth cubics so
  // script letters render round instead of turning at every sample vertex.
  const compiled = isPolylineDigitizedFont(fontKey) ? fairStrokeFont(native) : native;
  fontCache.set(fontKey, compiled);
  return compiled;
}
