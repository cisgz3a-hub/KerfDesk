// Colour-layer trace backend (ADR-430): split an image into N flat colours and
// trace every colour as its own filled path, with neighbouring colours sharing
// one identical boundary. Own design:
//   1. quantise in OKLab (colour-quantize.ts) and detect the paper colour;
//   2. build the label map's planar boundary graph (colour-regions.ts) — each
//      boundary between two colours is ONE chain;
//   3. place each chain sub-pixel (colour-chain-offsets.ts) and finish it into
//      curves once (colour-chain-geometry.ts);
//   4. assemble each colour's outlines (cut-out) or each colour plus every
//      darker colour stacked above it (stacked) from those shared chains.
// Output is one ColoredPath per colour, lightest first, with canonical curves.
//
// Pure core: deterministic, no clock, no random, no I/O.

import type { ColoredPath, CurveSubpath, Polyline, Vec2 } from '../scene';
import { resampleBuffer } from '../image-resample';
import {
  assembleRegionLoops,
  extractBoundaryChains,
  VOID_REGION,
  type BoundaryChain,
  type LoopPiece,
} from './colour-regions';
import { chainOffsets, junctionPositions } from './colour-chain-offsets';
import {
  finishChain,
  reversedGeometry,
  type ChainGeometry,
  type ChainSegment,
} from './colour-chain-geometry';
import { quantizeColours, TRANSPARENT_LABEL, type QuantizedColours } from './colour-quantize';
import { normalizedColourCount, type ColourLayerOptions } from './colour-layer-options';
import type { RawImageData, TraceOptions } from './trace-image';
import type { TraceSteps } from './trace-steps';

// Working-grid cap: above this many pixels the image is resampled down first
// (the per-pixel OKLab buffer alone is 12 bytes a pixel).
const MAX_WORKING_PIXELS = 4_000_000;
// Default speck area when the options carry none (Line Art's 12 px).
const DEFAULT_MIN_REGION_PX = 12;
const CHECKPOINT_CHAINS = 512;

/** True when options select the colour-layer backend. */
export function isColourLayerTrace(options: TraceOptions): boolean {
  if (options.colourLayers === undefined || options.photoDetail !== undefined) return false;
  return options.traceMode !== 'centerline' && options.traceMode !== 'edge';
}

export type ColourLayerTraceStats = {
  readonly palette: ReadonlyArray<string>;
  readonly background: string | null;
  readonly chains: number;
};

export function* traceColourLayersSteps(
  requested: RawImageData,
  options: TraceOptions,
  stats?: (value: ColourLayerTraceStats) => void,
): TraceSteps<ColoredPath[]> {
  const cooperate = yield;
  const layer: ColourLayerOptions = options.colourLayers ?? {};
  const image = workingImage(requested);
  const areaScale = (image.width * image.height) / Math.max(1, requested.width * requested.height);
  const colours = normalizedColourCount(layer.colours);
  const quantized = quantizeColours(image, {
    ...(colours === undefined ? {} : { colours }),
    minRegionPx: Math.max(0, options.despeckleMinPixels ?? DEFAULT_MIN_REGION_PX) * areaScale,
  });
  if (cooperate) yield;
  const traced = tracedRegions(quantized, layer.keepBackground === true);
  const chains = extractBoundaryChains({
    width: image.width,
    height: image.height,
    regions: traced.regions,
  });
  if (cooperate) yield;
  const offsets = chains.map((chain) => chainOffsets(chain, quantized));
  const junctions = junctionPositions(chains, offsets, image.width);
  const geometry: ChainGeometry[] = [];
  for (let i = 0; i < chains.length; i += 1) {
    if (cooperate && i % CHECKPOINT_CHAINS === 0) yield;
    geometry.push(
      finishChain(chains[i] as BoundaryChain, offsets[i] as Float64Array, junctions, image.width),
    );
  }
  stats?.(traceStats(quantized, chains.length));
  const paths = colourPaths(traced, quantized, chains, geometry, layer.output === 'stacked');
  const sx = requested.width / image.width;
  const sy = requested.height / image.height;
  return sx === 1 && sy === 1 ? paths : paths.map((path) => scaleColoredPath(path, sx, sy));
}

function workingImage(requested: RawImageData): RawImageData {
  const pixels = requested.width * requested.height;
  if (pixels <= MAX_WORKING_PIXELS) return requested;
  const scale = Math.sqrt(MAX_WORKING_PIXELS / pixels);
  return resampleBuffer(
    requested,
    Math.max(1, Math.round(requested.width * scale)),
    Math.max(1, Math.round(requested.height * scale)),
  );
}

function traceStats(quantized: QuantizedColours, chains: number): ColourLayerTraceStats {
  const background =
    quantized.backgroundIndex === null ? undefined : quantized.palette[quantized.backgroundIndex];
  return {
    palette: quantized.palette.map((c) => c.hex),
    background: background?.hex ?? null,
    chains,
  };
}

function colourPaths(
  traced: TracedRegions,
  quantized: QuantizedColours,
  chains: ReadonlyArray<BoundaryChain>,
  geometry: ReadonlyArray<ChainGeometry>,
  stacked: boolean,
): ColoredPath[] {
  const paths: ColoredPath[] = [];
  traced.order.forEach((label, stackIndex) => {
    const members = new Set(stacked ? traced.order.slice(stackIndex) : [label]);
    const loops = assembleRegionLoops(chains, (region) => members.has(region), quantized.width);
    if (loops.length === 0) return;
    const colour = quantized.palette[label]?.hex ?? '#000000';
    paths.push(loopsToColoredPath(colour, loops, geometry));
  });
  return paths;
}

type TracedRegions = {
  readonly regions: Int16Array;
  /** Traced palette labels, lightest first (bottom of a stack). */
  readonly order: ReadonlyArray<number>;
};

function tracedRegions(quantized: QuantizedColours, keepBackground: boolean): TracedRegions {
  const excluded = (label: number): boolean =>
    label === TRANSPARENT_LABEL || (!keepBackground && label === quantized.backgroundIndex);
  const regions = new Int16Array(quantized.labels.length);
  for (let i = 0; i < regions.length; i += 1) {
    const label = quantized.labels[i] as number;
    regions[i] = excluded(label) ? VOID_REGION : label;
  }
  const order = quantized.palette
    .map((colour, label) => ({ label, lightness: colour.lab[0] }))
    .filter((entry) => !excluded(entry.label))
    .sort((a, b) => b.lightness - a.lightness || a.label - b.label)
    .map((entry) => entry.label);
  return { regions, order };
}

// ——— outline assembly ———

function loopsToColoredPath(
  color: string,
  loops: ReadonlyArray<ReadonlyArray<LoopPiece>>,
  geometry: ReadonlyArray<ChainGeometry>,
): ColoredPath {
  const polylines: Polyline[] = [];
  const curves: CurveSubpath[] = [];
  for (const loop of loops) {
    const segments: ChainSegment[] = [];
    const points: Vec2[] = [];
    let start: Vec2 | undefined;
    for (const piece of loop) {
      const g = geometry[piece.chain] as ChainGeometry;
      const oriented = piece.reversed ? reversedGeometry(g) : g;
      if (start === undefined) start = oriented.start;
      segments.push(...oriented.segments);
      points.push(...(points.length === 0 ? oriented.samples : oriented.samples.slice(1)));
    }
    if (start === undefined || segments.length === 0) continue;
    // Closed rings return to their start point (ADR-100 third amendment).
    const first = points[0] as Vec2;
    points[points.length - 1] = first;
    polylines.push({ points, closed: true });
    curves.push({ start, segments, closed: true });
  }
  return { color, polylines, curves };
}

function scaleColoredPath(path: ColoredPath, sx: number, sy: number): ColoredPath {
  const p = (v: Vec2): Vec2 => ({ x: v.x * sx, y: v.y * sy });
  return {
    ...path,
    polylines: path.polylines.map((polyline) => ({
      closed: polyline.closed,
      points: polyline.points.map(p),
    })),
    curves: (path.curves ?? []).map((curve) => ({
      closed: curve.closed,
      start: p(curve.start),
      segments: curve.segments.map((segment) =>
        segment.kind === 'cubic'
          ? {
              kind: 'cubic' as const,
              control1: p(segment.control1),
              control2: p(segment.control2),
              to: p(segment.to),
            }
          : { ...segment, to: p(segment.to) },
      ),
    })),
  };
}
