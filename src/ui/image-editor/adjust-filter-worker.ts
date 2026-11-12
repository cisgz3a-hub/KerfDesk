/// <reference lib="webworker" />
// The Image Studio's neighbourhood-filter preview worker (ADR-245 Amendment
// 2). It runs the same runAdjustment and sampleWindowInto calls the dialog
// ran on the UI thread, on the same bytes, so a 1:1 preview still equals
// what OK applies. It keeps the last filtered document so a pan or zoom with
// unchanged settings only resamples. The client terminates it to cancel.

import { RGBA_CHANNELS, type RgbaBuffer } from '../../core/image-edit';
import { sampleWindowInto } from './adjust-preview-window';
import type { FilterPreviewRequest, FilterPreviewResponse } from './adjust-filter-worker-protocol';
import { runAdjustment } from './editor-adjustments';

// Progress messages at most this often: enough for a smooth bar.
const PROGRESS_INTERVAL_MS = 100;

let filtered: RgbaBuffer | null = null;

function post(response: FilterPreviewResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, transfer);
}

function filterSource(request: FilterPreviewRequest): RgbaBuffer {
  const { source, adjustment, id } = request;
  if (source === null) {
    if (filtered === null) throw new Error('No filtered document to resample.');
    return filtered;
  }
  filtered = null;
  let last = performance.now();
  const progress = (fraction: number): void => {
    const now = performance.now();
    if (now - last < PROGRESS_INTERVAL_MS) return;
    last = now;
    post({ kind: 'progress', id, fraction });
  };
  const { doc, clip, mask } = source;
  const { params, curvePoints } = adjustment;
  runAdjustment(adjustment.id, params, doc, clip, mask, curvePoints, progress);
  filtered = doc;
  return doc;
}

self.onmessage = (event: MessageEvent<FilterPreviewRequest>): void => {
  const request = event.data;
  try {
    const doc = filterSource(request);
    const { win } = request;
    const window: RgbaBuffer = {
      width: win.width,
      height: win.height,
      data: new Uint8ClampedArray(win.width * win.height * RGBA_CHANNELS),
    };
    sampleWindowInto(doc, win, window);
    post({ kind: 'done', id: request.id, window }, [window.data.buffer]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    post({ kind: 'error', id: request.id, message });
  }
};
