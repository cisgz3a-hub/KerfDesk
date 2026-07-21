// Pure color-space conversions for the Image Studio color picker (ADR-242,
// PP-C): RGB ⇄ HSV for the saturation×value pad + hue slider, hex parsing
// for the text field, and K% (ink gray) for the laser-centric shortcut.

import type { PaintColor } from '../../core/image-edit';

export type HsvColor = {
  /** 0..360 */
  readonly h: number;
  /** 0..1 */
  readonly s: number;
  /** 0..1 */
  readonly v: number;
};

export function rgbToHsv(color: PaintColor): HsvColor {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb(hsv: HsvColor): PaintColor {
  const c = hsv.v * hsv.s;
  const x = c * (1 - Math.abs(((hsv.h / 60) % 2) - 1));
  const m = hsv.v - c;
  const sector = Math.floor((((hsv.h % 360) + 360) % 360) / 60);
  const [r, g, b] =
    sector === 0
      ? [c, x, 0]
      : sector === 1
        ? [x, c, 0]
        : sector === 2
          ? [0, c, x]
          : sector === 3
            ? [0, x, c]
            : sector === 4
              ? [x, 0, c]
              : [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function rgbToHex(color: PaintColor): string {
  const part = (value: number): string => value.toString(16).padStart(2, '0');
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

/** Accepts #rgb and #rrggbb (case-insensitive, # optional); null if invalid. */
export function hexToRgb(hex: string): PaintColor | null {
  const raw = hex.trim().replace(/^#/, '');
  const long =
    raw.length === 3
      ? raw
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(long)) return null;
  return {
    r: parseInt(long.slice(0, 2), 16),
    g: parseInt(long.slice(2, 4), 16),
    b: parseInt(long.slice(4, 6), 16),
  };
}

/** Ink percentage: 0 = white, 100 = black (BT.601 luma complement). */
export function rgbToInkPercent(color: PaintColor): number {
  const luma = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
  return Math.round(((255 - luma) / 255) * 100);
}

export function inkPercentToRgb(percent: number): PaintColor {
  const clamped = Math.min(100, Math.max(0, percent));
  const value = Math.round(255 * (1 - clamped / 100));
  return { r: value, g: value, b: value };
}
