/**
 * Web Worker for image tracing. Runs imagetracerjs off the main thread.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
 */
/// <reference lib="webworker" />

import imageTracer from 'imagetracerjs';

export interface TraceWorkerOptions {
  threshold: number;
  turdsize: number;
  alphamax: number;
  opttolerance: number;
  invert: boolean;
}

export interface TraceWorkerMessageIn {
  id: number;
  grayscaleData: Uint8Array;
  width: number;
  height: number;
  options: TraceWorkerOptions;
}

type TraceSegment =
  | { type: 'L'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'Q'; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number };

interface TracedPathShape {
  segments: TraceSegment[];
  holechildren: number[];
  isholepath: boolean;
}

type PotraceItem =
  | { type: 'POINT'; x: number; y: number }
  | { type: 'CURVE'; x: number; y: number; x1: number; y1: number; x2: number; y2: number };

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

self.onmessage = (e: MessageEvent<TraceWorkerMessageIn>) => {
  const { id, grayscaleData, width, height, options } = e.data;

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < grayscaleData.length; i++) {
    let v = grayscaleData[i]!;
    if (options.invert) v = 255 - v;
    const bw = v < options.threshold ? 0 : 255;
    rgba[i * 4] = bw;
    rgba[i * 4 + 1] = bw;
    rgba[i * 4 + 2] = bw;
    rgba[i * 4 + 3] = 255;
  }

  const imgd = { data: rgba, width, height };

  const traceOpts = {
    colorsampling: 0,
    numberofcolors: 2,
    colorquantcycles: 1,
    blurradius: 0,
    pal: [
      { r: 0, g: 0, b: 0, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 },
    ],
    pathomit: options.turdsize,
    ltres: options.alphamax,
    qtres: options.opttolerance,
    rightangleenhance: false,
    layering: 0,
    linefilter: true,
    roundcoords: 1,
    strokewidth: 0,
    scale: 1,
  };

  const td = imageTracer.imagedataToTracedata(imgd, traceOpts);
  const blackLayer = td.layers[0] as TracedPathShape[];
  const contours = collectBlackLayerContours(blackLayer);

  self.postMessage({ id, contours });
};
