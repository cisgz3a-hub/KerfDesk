// The settings panel shows the finished preview's report only while the
// dialog still detects ink the way that preview did, and names the preview's
// grid when it is not the image's own size (ADR-559).

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import type { PreparedTrace } from './prepared-trace';
import {
  finishedTraceFacts,
  useTracePreviewFacts,
  type TraceDetectionRequest,
  type TracePreviewFacts,
} from './trace-preview-facts';
import type { TracePreviewState } from './use-trace-preview';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SHARP = TRACE_PRESETS['Sharp']!;
const file = new File(['fixture'], 'logo.png');
const report = { automaticThresholdLuma: 97 };

function prepared(
  options: TraceOptions = SHARP,
  grid = { width: 2048, height: 1024 },
  source = { width: 4096, height: 2048 },
): PreparedTrace {
  return {
    request: { file, options, boundary: null, boundaryMode: 'crop', sourceGrid: source },
    result: {
      paths: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      ...grid,
      report,
    },
  };
}

function current(options: TraceOptions = SHARP): TraceDetectionRequest {
  return { file, options, boundary: null, boundaryMode: 'crop' };
}

describe('finished trace facts', () => {
  it('keeps the report while only finishing controls differ', () => {
    for (const finishing of [
      { smoothness: 0.2 },
      { optimize: 1.4 },
      { ignoreLessThanPixels: 30 },
      { centerlineJoinGapPx: 0 },
    ]) {
      expect(finishedTraceFacts(prepared(), current({ ...SHARP, ...finishing })).report).toEqual(
        report,
      );
    }
  });

  it('withdraws the report when anything that decides detection differs', () => {
    const differs: ReadonlyArray<TraceDetectionRequest> = [
      current({ ...SHARP, medianFilter: true }),
      current({ ...SHARP, invert: true }),
      current({ ...SHARP, useOtsuThreshold: false, cutoffLuma: 0, thresholdLuma: 96 }),
      current(TRACE_PRESETS['Smooth']!),
      { ...current(), boundary: { x: 1, y: 1, width: 10, height: 10 } },
      { ...current(), boundaryMode: 'enhance' },
      { ...current(), file: new File(['fixture'], 'logo.png') },
    ];
    for (const request of differs) {
      expect(finishedTraceFacts(prepared(), request).report).toBeUndefined();
    }
    expect(finishedTraceFacts(prepared(), null)).toEqual({});
  });

  it('names the preview grid only when it differs from the image size', () => {
    expect(finishedTraceFacts(prepared(), current()).previewGrid).toEqual({
      width: 2048,
      height: 1024,
    });
    const native = prepared(SHARP, { width: 640, height: 480 }, { width: 640, height: 480 });
    expect(finishedTraceFacts(native, current()).previewGrid).toBeUndefined();
    // The grid belongs to the decoded file, so a detection change keeps it.
    const other = current({ ...SHARP, medianFilter: true });
    expect(finishedTraceFacts(prepared(), other)).toEqual({
      previewGrid: { width: 2048, height: 1024 },
    });
  });
});

describe('useTracePreviewFacts', () => {
  it('keeps the finished report while a newer preview with the same detection traces', async () => {
    const seen: TracePreviewFacts[] = [];
    function Probe(props: {
      readonly preview: TracePreviewState;
      readonly request: TraceDetectionRequest;
    }): null {
      const { file, options } = props.request;
      seen.push(useTracePreviewFacts(props.preview, file, options, props.request));
      return null;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    const render = async (preview: TracePreviewState, request: TraceDetectionRequest) =>
      act(async () => root.render(createElement(Probe, { preview, request })));
    const ready: TracePreviewState = {
      kind: 'ready',
      svg: '<svg/>',
      width: 2048,
      height: 1024,
      paths: [],
      preparedTrace: prepared(),
    };
    try {
      await render(ready, current());
      expect(seen.at(-1)?.report).toEqual(report);
      await render({ kind: 'tracing' }, current({ ...SHARP, smoothness: 0.2 }));
      expect(seen.at(-1)?.report).toEqual(report);
      expect(seen.at(-1)?.previewGrid).toEqual({ width: 2048, height: 1024 });
      await render({ kind: 'tracing' }, current({ ...SHARP, invert: true }));
      expect(seen.at(-1)?.report).toBeUndefined();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
