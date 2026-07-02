// aciToHex — AutoCAD Color Index → lowercase hex (Phase H.6). Colors only
// pick LAYER IDENTITY in LaserForge (layers are keyed by color), so the
// standard indices 1–9 and the 250–255 gray ramp are exact and the 10–249
// chromatic block uses the documented hue-band structure (24 hue bands × 10
// shades) as a deterministic approximation — distinct, stable, and close to
// AutoCAD's palette without shipping a 256-entry table.

const ACI_STANDARD: Readonly<Record<number, string>> = {
  1: '#ff0000',
  2: '#ffff00',
  3: '#00ff00',
  4: '#00ffff',
  5: '#0000ff',
  6: '#ff00ff',
  // ACI 7 is "white/black" — it renders as black on light backgrounds,
  // which is what our canvas is.
  7: '#000000',
  8: '#808080',
  9: '#c0c0c0',
};

const ACI_GRAY_RAMP: Readonly<Record<number, string>> = {
  250: '#333333',
  251: '#505050',
  252: '#696969',
  253: '#828282',
  254: '#bebebe',
  255: '#ffffff',
};

const CHROMATIC_FIRST = 10;
const CHROMATIC_LAST = 249;
const SHADES_PER_HUE = 10;
const HUE_STEP_DEG = 15;
// Value (brightness) pairs per band: full/dim × 5 levels, per the ACI layout.
const VALUE_LEVELS = [255, 204, 166, 128, 76] as const;
const HALF_SATURATION = 0.5;

export const DXF_DEFAULT_COLOR = ACI_STANDARD[7] as string;

export function aciToHex(index: number): string {
  const rounded = Math.trunc(index);
  const standard = ACI_STANDARD[rounded];
  if (standard !== undefined) return standard;
  const gray = ACI_GRAY_RAMP[rounded];
  if (gray !== undefined) return gray;
  if (rounded >= CHROMATIC_FIRST && rounded <= CHROMATIC_LAST) return chromaticAci(rounded);
  return DXF_DEFAULT_COLOR;
}

// 24-bit DXF true color (group 420): 0x00RRGGBB.
export function trueColorToHex(value: number): string {
  const rgb = Math.max(0, Math.trunc(value)) & 0xffffff;
  return `#${rgb.toString(16).padStart(6, '0')}`;
}

function chromaticAci(index: number): string {
  const offset = index - CHROMATIC_FIRST;
  const hueBand = Math.floor(offset / SHADES_PER_HUE);
  const shade = offset % SHADES_PER_HUE;
  const hueDeg = hueBand * HUE_STEP_DEG;
  const value = (VALUE_LEVELS[Math.floor(shade / 2)] ?? 255) / 255;
  const saturation = shade % 2 === 0 ? 1 : HALF_SATURATION;
  return hsvToHex(hueDeg, saturation, value);
}

function hsvToHex(hueDeg: number, s: number, v: number): string {
  const c = v * s;
  const hPrime = (hueDeg % 360) / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  const [r1, g1, b1] =
    hPrime < 1
      ? [c, x, 0]
      : hPrime < 2
        ? [x, c, 0]
        : hPrime < 3
          ? [0, c, x]
          : hPrime < 4
            ? [0, x, c]
            : hPrime < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = v - c;
  return `#${channel(r1 + m)}${channel(g1 + m)}${channel(b1 + m)}`;
}

function channel(fraction: number): string {
  const FULL_BYTE = 255;
  return Math.round(Math.max(0, Math.min(1, fraction)) * FULL_BYTE)
    .toString(16)
    .padStart(2, '0');
}
