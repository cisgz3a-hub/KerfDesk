// core/text — Phase D text-to-path module. Pure: takes content + a
// font ArrayBuffer, produces polylines. The UI layer owns the fetch
// of the font binary (font-registry maps key → asset path).

export type { KnownFontKey, FontEntry } from './font-registry';
export { FONT_REGISTRY, DEFAULT_FONT_KEY, findFontEntry } from './font-registry';

// TextObject + FontKey + TextAlignment live in scene/scene-object (with
// the union); re-exported here for convenience.
export type { FontKey, TextAlignment, TextObject } from './text-object';
export {
  DEFAULT_TEXT_ALIGNMENT,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_LETTER_SPACING,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_SIZE_MM,
} from './text-object';

export type { TextRenderInput, TextRenderResult } from './text-to-polylines';
export { textToPolylines } from './text-to-polylines';
export { TEXT_BEND_MAX_DEG, TEXT_BEND_MIN_DEG, bendTextRender, clampBend } from './text-bend';
export { MAX_EMBEDDED_FONT_BYTES, embeddedFontBuffer, encodeEmbeddedFont } from './embedded-font';
