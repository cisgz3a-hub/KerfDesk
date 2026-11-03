import { describe, expect, it, vi } from 'vitest';
import type * as ProgramTimelineModule from '../gcode-time/program-timeline';

// S3-P2-3: the job ETA must time the program from totals alone. Building the
// whole ProgramTimeline for it held about 1.25 GB of per-line and per-segment
// arrays for a bed-sized photo. This guard fails if estimateJobDuration goes
// back to the timeline, and pins its result to the timeline's on a real photo.
const timeline = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../gcode-time/program-timeline', async (importOriginal) => {
  const actual = await importOriginal<typeof ProgramTimelineModule>();
  return {
    ...actual,
    buildProgramTimeline: (...args: Parameters<typeof actual.buildProgramTimeline>) => {
      timeline.calls += 1;
      return actual.buildProgramTimeline(...args);
    },
  };
});

import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { buildProgramTimeline } from '../gcode-time/program-timeline';
import {
  deviceMotionLimits,
  deviceProgramTimingOptions,
} from '../gcode-time/program-timing-options';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../scene';
import { prepareOutput } from '../../io/gcode';
import { estimateJobDuration } from './estimate-duration';

function photoProject() {
  const width = 160;
  const height = 120;
  const luma = new Uint8Array(width * height);
  for (let i = 0; i < luma.length; i += 1) luma[i] = (i * 37 + ((i / width) | 0) * 11) % 256;
  const base = createProject(DEFAULT_DEVICE_PROFILE);
  return {
    ...base,
    scene: {
      ...base.scene,
      layers: [createLayer({ id: 'image', color: '#808080', mode: 'image' })],
      objects: [
        {
          kind: 'raster-image' as const,
          id: 'photo',
          source: 'photo.jpg',
          dataUrl: 'data:image/jpeg;base64,unused',
          pixelWidth: width,
          pixelHeight: height,
          bounds: { minX: 10, minY: 10, maxX: 26, maxY: 22 },
          transform: IDENTITY_TRANSFORM,
          color: '#808080',
          dither: 'floyd-steinberg' as const,
          linesPerMm: 10,
          lumaBase64: Buffer.from(luma).toString('base64'),
        },
      ],
    },
  };
}

describe('estimateJobDuration on a dithered photo', () => {
  it("gives the full timeline's totals without building the timeline", () => {
    const prepared = prepareOutput(photoProject(), {});
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const device = prepared.project.device;
    let gcode = '';
    timeline.calls = 0;

    const estimate = estimateJobDuration(prepared.job, device, {
      onEmittedProgram: (program) => {
        gcode = program;
      },
    });

    expect(timeline.calls).toBe(0);
    expect(gcode.split('\n').length).toBeGreaterThan(1_000);
    const reference = buildProgramTimeline(gcode, deviceMotionLimits(device), {
      ...deviceProgramTimingOptions(device, 'laser'),
      initialPositionMm: { x: 0, y: 0, z: 0 },
    });
    expect(reference.kind).toBe('ok');
    if (reference.kind !== 'ok') return;
    const t = reference.timeline;
    expect(estimate.totalSeconds).toBe(t.totalSeconds);
    expect(estimate.breakdown).toEqual({
      cutSeconds: t.breakdown.cutSeconds,
      travelSeconds: t.breakdown.rapidTravelSeconds + t.breakdown.feedTravelSeconds,
      rapidTravelSeconds: t.breakdown.rapidTravelSeconds,
      feedTravelSeconds: t.breakdown.feedTravelSeconds,
      dwellSeconds: t.dwellSeconds,
      transportSeconds: t.transportSeconds,
    });
    expect(estimate.manualPauseCount).toBeUndefined();
  });
});
