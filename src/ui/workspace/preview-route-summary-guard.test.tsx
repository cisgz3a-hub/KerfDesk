// Guard for performance audit S1-P2-1 (ADR-598 Amendment 2): opening Preview
// on a large worker-prepared route must not walk the route on the UI thread.
// The route crosses the real packed transport and hydration, then every read
// of it is counted — by call count, not by time, so the guard holds on any PC.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { Toolpath, ToolpathStep } from '../../core/job';
import { packedToolpathSteps } from '../../core/job/packed-toolpath-steps';
import { createProject } from '../../core/scene';
import { LARGE_SCENE_SEGMENT_THRESHOLD } from './draw-complexity';
import type { LargeJobPreparation } from './large-job-preparation';
import { PreviewControlsPanel, PreviewStatusOverlays } from './preview-overlays';
import { previewRouteSummary, withPreviewRouteSummary } from './preview-route-summary';
import {
  buildPreviewTimeline,
  elapsedSecondsAtScrubber,
  scrubberAtElapsedSeconds,
} from './preview-timeline';
import type { ActiveRequest } from './preparation-request';
import { PreparationTransferSender } from './preparation-transfer-sender';
import type { PreparationWorkerResponse } from './preparation-worker-protocol';
import { settleWorkerResponse } from './preparation-worker-response';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Over the display budget, so the decimation notice has real work to show.
const SPANS = LARGE_SCENE_SEGMENT_THRESHOLD / 2 + 5_000;

function fillRoute(): Toolpath {
  const steps: ToolpathStep[] = [];
  for (let index = 0; index < SPANS; index += 1) {
    const y = index * 0.05;
    steps.push({ kind: 'travel', from: { x: 0, y }, to: { x: 1, y }, length: 1, motion: 'feed' });
    steps.push({
      kind: 'cut',
      color: '#123456',
      polyline: [
        { x: 1, y },
        { x: 9, y },
      ],
      length: 8,
    });
  }
  return { steps: packedToolpathSteps(steps), totalLength: SPANS * 9 };
}

/** What the worker builds and posts, received and hydrated as the client does. */
async function workerDeliveredRoute(): Promise<Toolpath> {
  const preparation: LargeJobPreparation = {
    estimate: { kind: 'empty' },
    toolpath: withPreviewRouteSummary(fillRoute()),
  };
  let posted: PreparationWorkerResponse | null = null;
  const sender = new PreparationTransferSender((response, transfer) => {
    // The structured clone a postMessage makes, with the same transfer list.
    posted = structuredClone(response, { transfer: [...(transfer ?? [])] });
  });
  await sender.sendOwned(1, preparation);
  const response = posted as PreparationWorkerResponse | null;
  if (response?.kind !== 'packed') throw new Error('expected one packed response');
  let settled: LargeJobPreparation | null = null;
  const request = {
    id: 1,
    resolve: (value: LargeJobPreparation) => {
      settled = value;
    },
    reject: (error: unknown) => {
      throw error;
    },
  } as unknown as ActiveRequest;
  settleWorkerResponse(request, response);
  const delivered = settled as LargeJobPreparation | null;
  if (delivered === null) throw new Error('the response did not settle');
  return delivered.toolpath;
}

/** Count every read of the route other than its length. */
function countingReads(toolpath: Toolpath): { readonly toolpath: Toolpath; reads: () => number } {
  let reads = 0;
  const steps = new Proxy(toolpath.steps, {
    get(target, property, receiver) {
      if (property !== 'length') reads += 1;
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  return { toolpath: { ...toolpath, steps }, reads: () => reads };
}

describe('Preview of a worker-prepared route on the UI thread (S1-P2-1)', () => {
  it('arrives summarized across the packed transfer', async () => {
    const route = await workerDeliveredRoute();
    const summary = previewRouteSummary(route);
    expect(summary.stepCount).toBe(SPANS * 2);
    expect(summary.distances).toEqual({
      cutMm: SPANS * 8,
      travelMm: SPANS,
      plungeMm: 0,
      totalMm: SPANS * 9,
    });
    expect(summary.timeline.endCutMm).toHaveLength(SPANS * 2);
    expect(summary.displayDecimation?.sourceSteps).toBe(SPANS * 2);
  });

  it('builds the timeline, stats, pass stepper and notices without reading a step', async () => {
    const observed = countingReads(await workerDeliveredRoute());
    const { toolpath } = observed;

    const timeline = buildPreviewTimeline(toolpath, {
      cutSeconds: 800,
      travelSeconds: 100,
      rapidTravelSeconds: 0,
      feedTravelSeconds: 100,
    });
    expect(timeline.totalSeconds).toBe(900);
    expect(elapsedSecondsAtScrubber(timeline, 0.5)).toBeCloseTo(450, 6);
    expect(scrubberAtElapsedSeconds(timeline, 450)).toBeCloseTo(0.5, 9);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const estimate = {
      kind: 'estimated' as const,
      label: '15m',
      totalSeconds: 900,
      breakdown: { cutSeconds: 800, travelSeconds: 100 },
    };
    await act(async () =>
      root.render(
        <>
          <PreviewStatusOverlays project={createProject()} toolpath={toolpath} />
          <PreviewControlsPanel
            toolpath={toolpath}
            estimate={estimate}
            routeLabel="Whole project"
            disabled={false}
          />
        </>,
      ),
    );
    expect(host.textContent).toContain(`${(SPANS * 8).toFixed(1)} mm`);
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => root.unmount());
    host.remove();

    expect(observed.reads()).toBe(0);
  });
});
