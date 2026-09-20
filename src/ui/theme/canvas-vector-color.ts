import { getCanvasColorScheme } from './canvas-color-scheme';
import { canvasTheme, DARK_CANVAS_BED } from './canvas-theme';

// Display-only: callers use this paint in Canvas2D or the live text overlay,
// never in scene data, raster processing, export or job preparation.
export function canvasVectorDisplayColor(color: string): string {
  if (getCanvasColorScheme() !== 'dark') return color;
  const rgb = hexRgb(color);
  if (rgb === null || contrastWithDarkBed(rgb) >= 3) return color;
  // Default black/grey artwork uses the approved light ink. Low-contrast
  // chromatic colours are lightened with their relative channel order intact.
  if (Math.max(...rgb) - Math.min(...rgb) <= 16) return canvasTheme.artworkInk;
  let amount = 0.1;
  let display = rgb;
  while (contrastWithDarkBed(display) < 3 && amount <= 1) {
    display = rgb.map((channel) => Math.round(channel + (255 - channel) * amount));
    amount += 0.1;
  }
  return `#${display.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function hexRgb(color: string): number[] | null {
  if (color.toLowerCase() === 'black') return [0, 0, 0];
  const hex = color.replace(/^#/, '');
  if (!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) return null;
  const full = hex.length === 3 ? [...hex].map((digit) => digit.repeat(2)).join('') : hex;
  return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16));
}

function luminance(rgb: ReadonlyArray<number>): number {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
}

const DARK_BED_LUMINANCE = luminance(hexRgb(DARK_CANVAS_BED) ?? []);

function contrastWithDarkBed(rgb: ReadonlyArray<number>): number {
  const ink = luminance(rgb);
  return (Math.max(ink, DARK_BED_LUMINANCE) + 0.05) / (Math.min(ink, DARK_BED_LUMINANCE) + 0.05);
}
