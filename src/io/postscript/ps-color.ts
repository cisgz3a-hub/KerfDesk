// Device colours to the #rrggbb text the SVG importer keys operations on.
// CMYK uses the plain uncalibrated conversion (PLRM §7.2.4); no ICC profile
// is applied, so a colour can differ slightly from the source program's view.

export function grayHex(gray: number): string {
  const v = channel(gray);
  return hex(v, v, v);
}

export function rgbHex(r: number, g: number, b: number): string {
  return hex(channel(r), channel(g), channel(b));
}

export function cmykHex(c: number, m: number, y: number, k: number): string {
  const ink = (v: number): number => 1 - Math.min(1, clamp01(v) + clamp01(k));
  return rgbHex(ink(c), ink(m), ink(y));
}

export function hsbHex(h: number, s: number, b: number): string {
  const hue = (clamp01(h) * 6) % 6;
  const sat = clamp01(s);
  const val = clamp01(b);
  const sector = Math.floor(hue);
  const f = hue - sector;
  const p = val * (1 - sat);
  const q = val * (1 - sat * f);
  const t = val * (1 - sat * (1 - f));
  const table: readonly (readonly [number, number, number])[] = [
    [val, t, p],
    [q, val, p],
    [p, val, t],
    [p, q, val],
    [t, p, val],
    [val, p, q],
  ];
  const [r, g, b2] = table[sector] ?? [val, t, p];
  return rgbHex(r, g, b2);
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function channel(v: number): number {
  return Math.round(clamp01(v) * 255);
}

function hex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
