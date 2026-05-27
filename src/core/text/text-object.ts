// TextObject helpers + Phase D defaults. The type itself lives in
// scene/scene-object.ts (alongside the SceneObject discriminated
// union) to avoid a circular import: text-to-polylines needs the
// type, scene needs the type. Single source of truth.
//
// This file is for tunable defaults + a couple of convenience
// re-exports so callers can `import { ... } from '../text'` without
// reaching across module boundaries.

export type { FontKey, TextAlignment, TextObject } from '../scene/scene-object';

export const DEFAULT_TEXT_SIZE_MM = 10;
export const DEFAULT_TEXT_LINE_HEIGHT = 1.4;
// Letter spacing default: 0 = the font's natural kerning + advance.
// Positive widens, negative tightens. Multiplier of sizeMm so a value
// of 0.1 means each glyph gets 10% of em-height extra space.
export const DEFAULT_TEXT_LETTER_SPACING = 0;
export const DEFAULT_TEXT_COLOR = '#000000';
export const DEFAULT_TEXT_ALIGNMENT = 'left' as const;
