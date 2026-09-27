// Lens colours per look (ADR-426). Classic keeps its palette and its lighter
// rendered lines, and its legend shows them as rendered (ADR-425). Studio
// uses ramps that stay readable with colour-vision deficiency and dark-to-
// bright order, and its lines render exactly the colour its legend shows.

import { rgbTriple, type Viewer3dTheme } from '../viewer3d';
// Deep imports: the viewer3d barrel is capped at 20 exports by its index contract.
import { STUDIO_TRAVEL_COLOR, type Viewer3dLook } from '../viewer3d/viewer3d-look';
import { renderedLineCss } from '../viewer3d/segment-buckets';
import { DEPTH_RAMP_DEEP, DEPTH_RAMP_SHALLOW, type Rgb } from './depth-lens';

export type LensPalette = {
  readonly look: Viewer3dLook;
  readonly cut: Rgb;
  readonly plunge: Rgb;
  readonly retract: Rgb;
  readonly travel: Rgb;
  /** CSS for the travel swatch: its line is colour-managed in both looks. */
  readonly travelCss: string;
  /** Shallow to deep. */
  readonly depthRamp: ReadonlyArray<Rgb>;
  /** Low to high feed or power. */
  readonly valueRamp: ReadonlyArray<Rgb>;
  readonly reached: Rgb;
  readonly limited: Rgb;
  /** One colour per tool, in order of first use; repeats past the end. */
  readonly tools: ReadonlyArray<Rgb>;
  /** The CSS colour a line of this rgb shows on screen. */
  readonly lineCss: (rgb: Rgb) => string;
};

/* eslint-disable no-restricted-syntax -- toolpath data colours for the 3D
   scene and its legend, fixed by the palettes below; not UI chrome. */
// Okabe–Ito: distinct under the common colour-vision deficiencies and on a
// dark background. Studio's move kinds and tools draw from it.
const OKABE_ITO = ['#56b4e9', '#e69f00', '#009e73', '#f0e442', '#cc79a7', '#d55e00', '#0072b2'];
// Pale yellow to deep magenta (the inferno family): shallow reads bright and
// deep reads dark, and it survives greyscale printing.
const STUDIO_RAMP = ['#fcffa4', '#f7d13d', '#fb9b06', '#ed6925', '#cf4446', '#a52c60'];
/* eslint-enable no-restricted-syntax */
// Classic's cool-to-warm feed and power ramp, unchanged.
const CLASSIC_VALUE_RAMP: ReadonlyArray<Rgb> = [
  [0.24, 0.42, 0.85],
  [0.98, 0.76, 0.19],
];
const CLASSIC_REACHED: Rgb = [0.35, 0.72, 0.45];
const CLASSIC_LIMITED: Rgb = [0.9, 0.5, 0.2];

export function lensPalette(theme: Viewer3dTheme, look: Viewer3dLook = 'classic'): LensPalette {
  return look === 'studio' ? studioPalette() : classicPalette(theme);
}

function classicPalette(theme: Viewer3dTheme): LensPalette {
  const cut = rgbTriple(theme.cut);
  return {
    look: 'classic',
    cut,
    plunge: rgbTriple(theme.plunge),
    retract: rgbTriple(theme.retract),
    travel: rgbTriple(theme.travel),
    travelCss: hexCss(theme.travel),
    depthRamp: [DEPTH_RAMP_SHALLOW, DEPTH_RAMP_DEEP],
    valueRamp: CLASSIC_VALUE_RAMP,
    reached: CLASSIC_REACHED,
    limited: CLASSIC_LIMITED,
    // A one-tool program keeps Classic's familiar cut blue.
    tools: [cut, ...OKABE_ITO.slice(1).map(hexRgb)],
    lineCss: renderedLineCss,
  };
}

function studioPalette(): LensPalette {
  const [cut, plunge, green, , retract] = OKABE_ITO.map(hexRgb);
  const fallback: Rgb = [1, 1, 1];
  return {
    look: 'studio',
    cut: cut ?? fallback,
    plunge: plunge ?? fallback,
    retract: retract ?? fallback,
    travel: rgbTriple(STUDIO_TRAVEL_COLOR),
    travelCss: hexCss(STUDIO_TRAVEL_COLOR),
    depthRamp: STUDIO_RAMP.map(hexRgb),
    valueRamp: [...STUDIO_RAMP].reverse().map(hexRgb),
    reached: green ?? fallback,
    limited: plunge ?? fallback,
    tools: OKABE_ITO.map(hexRgb),
    lineCss: exactCss,
  };
}

/** The colour `t` (0 to 1) of the way along a ramp of evenly spaced stops. */
export function rampAt(stops: ReadonlyArray<Rgb>, t: number): Rgb {
  const last = stops.length - 1;
  if (last <= 0) return stops[0] ?? [1, 1, 1];
  const position = Math.min(1, Math.max(0, t)) * last;
  const index = Math.min(last - 1, Math.floor(position));
  const from = stops[index] ?? [1, 1, 1];
  const to = stops[index + 1] ?? from;
  const f = position - index;
  return [
    from[0] + (to[0] - from[0]) * f,
    from[1] + (to[1] - from[1]) * f,
    from[2] + (to[2] - from[2]) * f,
  ];
}

/** CSS gradient stops that follow a ramp the way its lines render. */
export function rampCss(palette: LensPalette, stops: ReadonlyArray<Rgb>): ReadonlyArray<string> {
  const count = Math.max(7, stops.length * 2 - 1);
  return Array.from({ length: count }, (_, index) =>
    palette.lineCss(rampAt(stops, index / (count - 1))),
  );
}

export function toolColor(palette: LensPalette, toolIndex: number): Rgb {
  return palette.tools[toolIndex % palette.tools.length] ?? palette.cut;
}

function exactCss(rgb: Rgb): string {
  const channel = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);
  return `rgb(${channel(rgb[0])}, ${channel(rgb[1])}, ${channel(rgb[2])})`;
}

function hexRgb(hex: string): Rgb {
  return rgbTriple(Number.parseInt(hex.slice(1), 16));
}

function hexCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
