/**
 * Web Worker for image tracing. Runs the Potrace-style bitmap path,
 * polygon, vertex-adjustment, and smoothing pipeline off the main thread.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
 */
/// <reference lib="webworker" />

import type { SubPath } from '../../core/scene/SceneObject';
import { grayscaleToTraceBitmap } from './TraceBitmap';
import { traceBitmapToSubPaths } from './PotraceTraceBackend';

export interface TraceWorkerOptions {
  cutoff: number;
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

interface TraceWorkerMessageOut {
  id: number;
  subPaths: SubPath[];
}

self.onmessage = (e: MessageEvent<TraceWorkerMessageIn>) => {
  const { id, grayscaleData, width, height, options } = e.data;
  const bitmap = grayscaleToTraceBitmap(grayscaleData, width, height, {
    ...options,
    turdsize: 0,
  });
  const subPaths = traceBitmapToSubPaths(bitmap, {
    turdsize: options.turdsize,
    alphamax: options.alphamax,
    opttolerance: options.opttolerance,
    optcurve: true,
    turnpolicy: 'minority',
  });

  const response: TraceWorkerMessageOut = { id, subPaths };
  self.postMessage(response);
};
