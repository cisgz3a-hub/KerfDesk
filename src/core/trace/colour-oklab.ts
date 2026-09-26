// sRGB <-> OKLab conversions for the colour-layer trace (ADR-430). OKLab is
// B. Ottosson's published perceptual colour space ("A perceptual color space
// for image processing", 2020); the matrices below are the published ones.
// sRGB transfer per IEC 61966-2-1. Pure core.

export type OkLab = readonly [number, number, number];
export type Srgb = readonly [number, number, number];

const SRGB_TO_LINEAR = buildSrgbToLinear();

function buildSrgbToLinear(): Float64Array {
  const table = new Float64Array(256);
  for (let i = 0; i < 256; i += 1) {
    const c = i / 255;
    table[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return table;
}

/** sRGB bytes → OKLab. */
export function srgbToOkLab(r: number, g: number, b: number): [number, number, number] {
  const lr = SRGB_TO_LINEAR[r & 255] as number;
  const lg = SRGB_TO_LINEAR[g & 255] as number;
  const lb = SRGB_TO_LINEAR[b & 255] as number;
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab → gamut-clipped sRGB bytes. */
export function okLabToSrgb(lab: OkLab): [number, number, number] {
  const [L, a, b] = lab;
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgbByte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgbByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgbByte(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** OKLab → lowercase #rrggbb (gamut-clipped). */
export function okLabToHex(lab: OkLab): string {
  return `#${okLabToSrgb(lab).map(byteHex).join('')}`;
}

/** OKLab lightness of a #rrggbb colour (0 black .. 1 white). */
export function hexOkLightness(hex: string): number {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(value)) return 0;
  return srgbToOkLab((value >> 16) & 255, (value >> 8) & 255, value & 255)[0];
}

function linearToSrgbByte(c: number): number {
  const v = Math.max(0, Math.min(1, c));
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

function byteHex(v: number): string {
  return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
}
