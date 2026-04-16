/**
 * Potrace-compatible tracing API backed by imagetracerjs (Unlicense / public domain).
 * Keeps existing contour converters unchanged; only replaces GPL potrace-js.
 */
import imageTracer from 'imagetracerjs';

export interface TraceCanvasOpts {
  turdsize?: number;
  alphamax?: number;
  opttolerance?: number;
  optcurve?: boolean;
  turnpolicy?: string;
}

export type PotraceItem =
  | { type: 'POINT'; x: number; y: number }
  | { type: 'CURVE'; x: number; y: number; x1: number; y1: number; x2: number; y2: number };

type TraceSegment =
  | { type: 'L'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'Q'; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number };

interface TracedPathShape {
  segments: TraceSegment[];
  holechildren: number[];
  isholepath: boolean;
}

export interface PathList {
  readonly _laserforgeTrace: true;
  readonly contours: PotraceItem[][];
}

function segmentsToPotraceItems(smp: TracedPathShape): PotraceItem[] {
  const items: PotraceItem[] = [];
  const segs = smp.segments;
  if (segs.length === 0) return items;

  const first = segs[0];
  items.push({ type: 'POINT', x: first.x1, y: first.y1 });

  for (const s of segs) {
    if (s.type === 'L') {
      items.push({ type: 'POINT', x: s.x2, y: s.y2 });
    } else if (s.type === 'Q') {
      const cp1x = s.x1 + (2 / 3) * (s.x2 - s.x1);
      const cp1y = s.y1 + (2 / 3) * (s.y2 - s.y1);
      const cp2x = s.x3 + (2 / 3) * (s.x2 - s.x3);
      const cp2y = s.y3 + (2 / 3) * (s.y2 - s.y3);
      items.push({
        type: 'CURVE',
        x1: cp1x,
        y1: cp1y,
        x2: cp2x,
        y2: cp2y,
        x: s.x3,
        y: s.y3,
      });
    }
  }
  return items;
}

function collectBlackLayerContours(blackLayer: TracedPathShape[]): PotraceItem[][] {
  const contours: PotraceItem[][] = [];
  for (let i = 0; i < blackLayer.length; i++) {
    const smp = blackLayer[i];
    if (smp.isholepath) continue;
    contours.push(segmentsToPotraceItems(smp));
    for (const hi of smp.holechildren) {
      contours.push(segmentsToPotraceItems(blackLayer[hi]));
    }
  }
  return contours;
}

/**
 * Match prior potrace-js: trace dark pixels as foreground on a canvas (e.g. black on white).
 */
export function traceCanvas(canvas: HTMLCanvasElement, opts: TraceCanvasOpts): PathList {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { _laserforgeTrace: true, contours: [] };
  }

  const imgd = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const turd = opts.turdsize ?? 8;
  const ltres = opts.alphamax ?? 1;
  const qtres = opts.opttolerance ?? 1;

  const traceOpts = {
    colorsampling: 0,
    numberofcolors: 2,
    colorquantcycles: 1,
    blurradius: 0,
    pal: [
      { r: 0, g: 0, b: 0, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 },
    ],
    pathomit: turd,
    ltres,
    qtres,
    rightangleenhance: true,
    layering: 0,
    linefilter: false,
    roundcoords: 1,
    strokewidth: 0,
    scale: 1,
  };

  const td = imageTracer.imagedataToTracedata(imgd, traceOpts);
  const blackLayer = td.layers[0] as TracedPathShape[];
  const contours = collectBlackLayerContours(blackLayer);

  return { _laserforgeTrace: true, contours };
}

export function getPaths(pathList: PathList): PotraceItem[][] {
  return pathList.contours;
}
