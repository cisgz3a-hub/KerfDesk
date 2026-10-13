import { describe, expect, it, vi } from 'vitest';
import type { CutGroup, Job, RasterGroup } from '../../core/job';
import { createProject } from '../../core/scene';
import { reusableStartPoints, startEditingContext } from '../workspace/canvas-start-editing';
import { buildCanvasMarkerPlan } from './canvas-motion-plan';
import { buildCanvasStartEditingData } from './canvas-start-editing-data';
import {
  inheritCanvasStartBoundsLoader,
  loadCanvasStartBounds,
  registerCanvasStartBoundsLoader,
} from './canvas-start-bounds-loader';

const project = {
  ...createProject(),
  startPoints: { job: { x: 25, y: 20 } },
};
const cut: CutGroup = {
  kind: 'cut',
  layerId: 'line',
  color: '#000000',
  power: 50,
  speed: 1000,
  passes: 1,
  airAssist: false,
  segments: [
    {
      closed: false,
      polyline: [
        { x: 20, y: 20 },
        { x: 30, y: 20 },
      ],
    },
  ],
};
function raster(rowProvider: NonNullable<RasterGroup['rowProvider']>): RasterGroup {
  return {
    ...cut,
    kind: 'raster',
    pixelWidth: 1,
    pixelHeight: 100000,
    bounds: { minX: 100, maxX: 101, minY: 200, maxY: 100200 },
    sValues: new Uint16Array(),
    rowProvider,
    overscanMm: 0,
    dotWidthCorrectionMm: 0,
  };
}
function prepared(job: Job) {
  return { ok: true as const, project, job, jobOriginOffset: { x: 0, y: 0 } };
}
const machine = { statusReport: null, alarmCode: null, hasActiveStreamer: false };

describe('on-demand start preference bounds', () => {
  it('does not read later raster rows just because an absolute cutting start was saved', () => {
    const rows = vi.fn(() => {
      throw new Error('unused raster rows must remain lazy');
    });
    const data = buildCanvasStartEditingData(prepared({ groups: [cut, raster(rows)] }));
    expect(rows).not.toHaveBeenCalled();
    expect(data.bounds).toBeUndefined();
    expect(structuredClone(data).job.groups).toEqual([cut]);
  });

  it('reads only the first executable raster row to explain its generated start', () => {
    const rows = vi.fn((index: number) => {
      if (index > 0) throw new Error('later rows must remain lazy');
      return new Uint16Array([500]);
    });
    const data = buildCanvasStartEditingData(prepared({ groups: [raster(rows), cut] }));
    expect(rows.mock.calls).toEqual([[0]]);
    expect(data.bounds).toBeUndefined();
    expect(data.job.groups).toEqual([]);
    expect(() => structuredClone(data)).not.toThrow();
  });

  it('does not save proportions from the compact first operation without a full-bounds loader', async () => {
    const plan = structuredClone(
      buildCanvasMarkerPlan({ prepared: prepared({ groups: [cut] }), machine }),
    );
    const context = startEditingContext(plan, project);
    if (context === undefined) throw new Error('Missing context');
    await expect(reusableStartPoints(context)).rejects.toThrow('not ready');
  });

  it('rebases the current idle bounds loader onto a matching retained terminal plan', async () => {
    const base = buildCanvasMarkerPlan({ prepared: prepared({ groups: [cut] }), machine });
    const data = base.startEditingData;
    if (data === undefined) throw new Error('Missing metadata');
    const idle = { ...base, startEditingData: { ...data, jobOriginOffset: { x: 100, y: -50 } } };
    const live = { ...base, startEditingData: { ...data, jobOriginOffset: { x: -10, y: 5 } } };
    const load = vi.fn(async () => ({ minX: 120, maxX: 130, minY: -30, maxY: -20 }));
    registerCanvasStartBoundsLoader(idle, load);
    inheritCanvasStartBoundsLoader(live, idle);
    expect(load).not.toHaveBeenCalled();
    await expect(loadCanvasStartBounds(live)).resolves.toEqual({
      minX: 10,
      maxX: 20,
      minY: 25,
      maxY: 35,
    });
    const stale = { ...live, retentionKey: 'different project' };
    inheritCanvasStartBoundsLoader(stale, idle);
    await expect(loadCanvasStartBounds(stale)).rejects.toThrow('not ready');
  });
});
