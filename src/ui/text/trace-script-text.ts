import {
  curveSubpathBounds,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenCurveSubpath,
  type Bounds,
  type CurveSubpath,
  type PathSegment,
  type Vec2,
} from '../../core/scene';
import { traceCenterlineStrokePaths, type TraceOptions } from '../../core/trace';
import type { TextRenderResult } from '../../core/text';
import {
  cssFamilyForTracedScript,
  ensureTracedScriptFontCss,
  type TracedScriptFontKey,
} from './font-loader';

type TraceScriptTextInput = {
  readonly fontKey: TracedScriptFontKey;
  readonly content: string;
  readonly sizeMm: number;
  readonly alignment: 'left' | 'center' | 'right';
  readonly lineHeight: number;
  readonly letterSpacing?: number;
  readonly color: string;
};

type ScriptCanvasContext = CanvasRenderingContext2D & {
  fontKerning: CanvasFontKerning;
  letterSpacing: string;
};

const BASE_FONT_PX = 220;
const PADDING_PX = 180;
const MAX_CANVAS_EDGE_PX = 8192;
// eslint-disable-next-line no-restricted-syntax -- Raster scene input requires literal palette colors.
const TRACE_BACKGROUND = '#ffffff';
// eslint-disable-next-line no-restricted-syntax -- Raster scene input requires literal palette colors.
const TRACE_FOREGROUND = '#000000';

const CENTERLINE_OPTIONS: TraceOptions = {
  traceMode: 'centerline',
  numberOfColors: 2,
  pathOmit: 0,
  lineTolerance: 1.5,
  quadraticTolerance: 1.5,
  blurRadius: 0,
  blurDelta: 0,
  lineFilter: true,
  fixedPalette: [TRACE_BACKGROUND, TRACE_FOREGROUND],
  useOtsuThreshold: true,
  despeckleMinPixels: 10,
  centerlineJoinGapPx: 4,
};

export function canTraceScriptText(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof FontFace !== 'undefined' &&
    typeof ImageData !== 'undefined'
  );
}

/** Converts a genuine handwriting outline into open CNC center strokes. */
export async function traceScriptText(input: TraceScriptTextInput): Promise<TextRenderResult> {
  await ensureTracedScriptFontCss(input.fontKey);
  const layout = layoutCanvas(input, BASE_FONT_PX);
  const fontPx = fittedFontSize(layout.width, layout.height, BASE_FONT_PX);
  const fitted = fontPx === BASE_FONT_PX ? layout : layoutCanvas(input, fontPx);
  const canvas = document.createElement('canvas');
  canvas.width = fitted.width;
  canvas.height = fitted.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('Canvas 2D is unavailable for script centerline tracing.');
  paintText(context as ScriptCanvasContext, input, fitted, fontPx);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const traced = traceCenterlineStrokePaths(pixels, CENTERLINE_OPTIONS);
  return normalizedResult(
    traced.flatMap((path) => path.curves ?? []),
    input.sizeMm / fontPx,
    input.color,
  );
}

type CanvasLayout = {
  readonly lines: ReadonlyArray<string>;
  readonly widths: ReadonlyArray<number>;
  readonly leftBearings: ReadonlyArray<number>;
  readonly ascent: number;
  readonly descent: number;
  readonly lineStep: number;
  readonly width: number;
  readonly height: number;
};

function layoutCanvas(input: TraceScriptTextInput, fontPx: number): CanvasLayout {
  const measureCanvas = document.createElement('canvas');
  const raw = measureCanvas.getContext('2d');
  if (raw === null) throw new Error('Canvas 2D is unavailable for script text layout.');
  const context = raw as ScriptCanvasContext;
  applyFont(context, input, fontPx);
  const lines = input.content.split('\n');
  const metrics = lines.map((line) => context.measureText(line.length === 0 ? ' ' : line));
  const widths = metrics.map((value) =>
    Math.max(value.width, value.actualBoundingBoxLeft + value.actualBoundingBoxRight),
  );
  const leftBearings = metrics.map((value) => Math.max(0, value.actualBoundingBoxLeft));
  const ascent = Math.max(fontPx * 0.8, ...metrics.map((value) => value.actualBoundingBoxAscent));
  const descent = Math.max(
    fontPx * 0.25,
    ...metrics.map((value) => value.actualBoundingBoxDescent),
  );
  const lineStep = fontPx * input.lineHeight;
  return {
    lines,
    widths,
    leftBearings,
    ascent,
    descent,
    lineStep,
    width: Math.max(1, Math.ceil(Math.max(0, ...widths) + PADDING_PX * 2)),
    height: Math.max(
      1,
      Math.ceil(PADDING_PX * 2 + ascent + descent + Math.max(0, lines.length - 1) * lineStep),
    ),
  };
}

function fittedFontSize(width: number, height: number, requested: number): number {
  const ratio = Math.min(1, MAX_CANVAS_EDGE_PX / width, MAX_CANVAS_EDGE_PX / height);
  return Math.max(40, requested * ratio);
}

function paintText(
  raw: CanvasRenderingContext2D,
  input: TraceScriptTextInput,
  layout: CanvasLayout,
  fontPx: number,
): void {
  const context = raw as ScriptCanvasContext;
  context.fillStyle = TRACE_BACKGROUND;
  context.fillRect(0, 0, layout.width, layout.height);
  context.fillStyle = TRACE_FOREGROUND;
  context.textBaseline = 'alphabetic';
  applyFont(context, input, fontPx);
  const maxWidth = Math.max(0, ...layout.widths);
  layout.lines.forEach((line, index) => {
    const width = layout.widths[index] ?? 0;
    const alignmentOffset =
      input.alignment === 'center'
        ? (maxWidth - width) / 2
        : input.alignment === 'right'
          ? maxWidth - width
          : 0;
    const x = PADDING_PX + alignmentOffset + (layout.leftBearings[index] ?? 0);
    const y = PADDING_PX + layout.ascent + index * layout.lineStep;
    context.fillText(line, x, y);
  });
}

function applyFont(
  context: ScriptCanvasContext,
  input: TraceScriptTextInput,
  fontPx: number,
): void {
  context.font = `${fontPx}px "${cssFamilyForTracedScript(input.fontKey)}"`;
  context.fontKerning = 'normal';
  context.letterSpacing = `${(input.letterSpacing ?? 0) * fontPx}px`;
}

function normalizedResult(
  source: ReadonlyArray<CurveSubpath>,
  scale: number,
  color: string,
): TextRenderResult {
  if (source.length === 0) {
    return {
      paths: [{ color, polylines: [], curves: [] }],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };
  }
  const scaled = source.map((curve) => transformCurve(curve, scale, 0, 0));
  const bounds = scaled.map(curveSubpathBounds).reduce(mergeBounds);
  const curves = scaled.map((curve) => transformCurve(curve, 1, -bounds.minX, -bounds.minY));
  const polylines = curves.map((curve) => {
    const flattened = flattenCurveSubpath(curve, {
      toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    });
    if (flattened.kind !== 'ok') throw new Error('Traced script exceeds the curve segment budget.');
    return { ...flattened.polyline, closed: false };
  });
  return {
    paths: [{ color, polylines, curves }],
    bounds: { minX: 0, minY: 0, maxX: bounds.maxX - bounds.minX, maxY: bounds.maxY - bounds.minY },
  };
}

function transformCurve(curve: CurveSubpath, scale: number, dx: number, dy: number): CurveSubpath {
  const point = (value: Vec2): Vec2 => ({ x: value.x * scale + dx, y: value.y * scale + dy });
  return {
    start: point(curve.start),
    closed: false,
    segments: curve.segments.map((segment): PathSegment => {
      if (segment.kind === 'line') return { kind: 'line', to: point(segment.to) };
      if (segment.kind === 'cubic') {
        return {
          kind: 'cubic',
          control1: point(segment.control1),
          control2: point(segment.control2),
          to: point(segment.to),
        };
      }
      return {
        ...segment,
        radiusX: segment.radiusX * scale,
        radiusY: segment.radiusY * scale,
        to: point(segment.to),
      };
    }),
  };
}

function mergeBounds(left: Bounds, right: Bounds): Bounds {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  };
}
