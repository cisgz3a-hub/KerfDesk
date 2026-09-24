// Physical layout of a barcode object in millimetres, local coordinates with
// the origin at the top-left of the quiet-zone box and y down. Every edge
// lies on a module boundary: matrix codes become merged region outlines,
// 1D codes one rectangle per bar. Inverted codes engrave the light modules
// and quiet zone instead, for stock that marks light (anodised aluminium,
// slate); the marks then sit inside the box as holes under even-odd fill.

import type { Polyline } from '../scene';
import type { BarcodeShape } from '../scene/scene-object';
import {
  encodeBarcodeSymbol,
  type LinearBarcodeSymbol,
  type MatrixBarcodeSymbol,
} from './barcode-symbol';
import { MIN_QUIET_ZONE } from './barcode-spec';
import { moduleContours } from './module-contours';

export type BarcodeCaption = {
  readonly text: string;
  readonly centerXMm: number;
  /** Top of the text's ink. */
  readonly topMm: number;
  readonly sizeMm: number;
};

export type BarcodeLayout = {
  /** Module or bar outlines; for inverted matrix codes they include the box. */
  readonly marks: readonly Polyline[];
  /** Inverted 1D codes add a box rectangle around marks and captions. */
  readonly background: boolean;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly paddingMm: number;
  readonly moduleMm: number;
  readonly captions: readonly BarcodeCaption[];
  readonly description: string;
  readonly warnings: readonly string[];
};

export type BarcodeLayoutResult =
  | { readonly ok: true; readonly layout: BarcodeLayout }
  | { readonly ok: false; readonly message: string };

const MIN_MODULE_MM = 0.05;
const SMALL_MODULE_MM = 0.2;
// EAN/UPC guard bars reach 5 modules below the data bars (GS1 §5.2.3.4).
const GUARD_EXTENSION_MODULES = 5;
const CAPTION_SIZE_MODULES = 10;
const CAPTION_GAP_MODULES = 1;
// Approximate ink height per font size: digits only, and any ASCII text.
const DIGIT_INK = 0.75;
const TEXT_INK = 1;
const APPROX_ADVANCE = 0.6;

export function layoutBarcode(spec: BarcodeShape, data: string): BarcodeLayoutResult {
  const encoded = encodeBarcodeSymbol(spec.symbology, data, spec.errorCorrection);
  if (!encoded.ok) return encoded;
  const symbol = encoded.symbol;
  const across =
    (symbol.kind === 'matrix' ? symbol.size : symbol.symbol.modules.length) +
    2 * spec.quietZoneModules;
  const moduleMm = spec.sizeMode === 'width' ? spec.widthMm / across : spec.moduleMm;
  if (!(moduleMm >= MIN_MODULE_MM)) {
    return {
      ok: false,
      message: `Modules would be ${moduleMm.toFixed(3)} mm wide. Make the code larger or the data shorter.`,
    };
  }
  const warnings = layoutWarnings(spec, moduleMm);
  const layout =
    symbol.kind === 'matrix'
      ? matrixLayout(spec, symbol, moduleMm)
      : linearLayout(spec, symbol, moduleMm);
  return { ok: true, layout: { ...layout, warnings } };
}

/** Closed outlines to engrave for a final box height (captions may deepen it). */
export function layoutPolylines(layout: BarcodeLayout, heightMm = layout.heightMm): Polyline[] {
  if (!layout.background) return [...layout.marks];
  return [rectangle(0, 0, layout.widthMm, heightMm), ...layout.marks];
}

function layoutWarnings(spec: BarcodeShape, moduleMm: number): string[] {
  const warnings: string[] = [];
  const minimum = MIN_QUIET_ZONE[spec.symbology];
  if (spec.quietZoneModules < minimum) {
    warnings.push(
      `The quiet zone is below the standard ${minimum} modules; some scanners may fail.`,
    );
  }
  if (moduleMm < SMALL_MODULE_MM) {
    warnings.push(`Modules of ${moduleMm.toFixed(2)} mm need a fine beam; test-scan a sample.`);
  }
  return warnings;
}

type PartialLayout = Omit<BarcodeLayout, 'warnings'>;

function matrixLayout(
  spec: BarcodeShape,
  symbol: MatrixBarcodeSymbol,
  moduleMm: number,
): PartialLayout {
  const quiet = spec.quietZoneModules;
  const across = symbol.size + 2 * quiet;
  const mask = new Uint8Array(across * across).fill(spec.invert ? 1 : 0);
  for (let y = 0; y < symbol.size; y += 1) {
    for (let x = 0; x < symbol.size; x += 1) {
      const dark = symbol.modules[y * symbol.size + x] === 1;
      mask[(y + quiet) * across + x + quiet] = dark !== spec.invert ? 1 : 0;
    }
  }
  const marks = moduleContours(across, across, mask).map((loop) => ({
    points: loop.map((point) => ({ x: point.x * moduleMm, y: point.y * moduleMm })),
    closed: true,
  }));
  return {
    marks,
    background: false,
    widthMm: across * moduleMm,
    heightMm: across * moduleMm,
    paddingMm: quiet * moduleMm,
    moduleMm,
    captions: [],
    description: symbol.description,
  };
}

function linearLayout(
  spec: BarcodeShape,
  linear: LinearBarcodeSymbol,
  moduleMm: number,
): PartialLayout {
  const { modules, extendedBars, text } = linear.symbol;
  const quiet = spec.quietZoneModules;
  const padding = Math.min(quiet, 2) * moduleMm;
  const showText = spec.showText && text.length > 0;
  const captionSize = showText ? captionSizeMm(linear, moduleMm) : 0;
  const barBottom = padding + spec.barHeightMm;
  const guardBottom = showText ? barBottom + GUARD_EXTENSION_MODULES * moduleMm : barBottom;
  const textTop = barBottom + CAPTION_GAP_MODULES * moduleMm;
  const allDigits = text.every((run) => /^\d*$/.test(run.text));
  const textBottom = showText
    ? textTop + captionSize * (allDigits ? DIGIT_INK : TEXT_INK)
    : barBottom;
  const marks: Polyline[] = [];
  for (let start = 0; start < modules.length; ) {
    let end = start;
    while (modules[end] === '1') end += 1;
    if (end > start) {
      const bottom = extendedBars.has(start) ? guardBottom : barBottom;
      marks.push(rectangle((quiet + start) * moduleMm, padding, (quiet + end) * moduleMm, bottom));
    }
    start = Math.max(end, start + 1);
  }
  const captions = showText
    ? text.map((run) => ({
        text: run.text,
        centerXMm: (quiet + (run.fromModule + run.toModule) / 2) * moduleMm,
        topMm: textTop,
        sizeMm: run.small === true ? captionSize * 0.8 : captionSize,
      }))
    : [];
  return {
    marks,
    background: spec.invert,
    widthMm: (modules.length + 2 * quiet) * moduleMm,
    heightMm: Math.max(guardBottom, textBottom) + padding,
    paddingMm: padding,
    moduleMm,
    captions,
    description: linear.description,
  };
}

// Digits keep the EAN/UPC proportion; longer free text shrinks to fit its span.
function captionSizeMm(linear: LinearBarcodeSymbol, moduleMm: number): number {
  const fits = linear.symbol.text.map(
    (run) =>
      ((run.toModule - run.fromModule) * moduleMm) /
      (Math.max(1, run.text.length) * APPROX_ADVANCE),
  );
  return Math.min(CAPTION_SIZE_MODULES * moduleMm, ...fits);
}

function rectangle(minX: number, minY: number, maxX: number, maxY: number): Polyline {
  const points = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
    { x: minX, y: minY },
  ];
  return { points, closed: true };
}
