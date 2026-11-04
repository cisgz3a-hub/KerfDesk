// ADR-598 Amendment 4 (performance audit S4-P2-1): an everyday design is
// prepared off the UI thread for Preview, the estimate, Frame, Start and Save.
// The guard counts compiles on the window, not milliseconds.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { everydayMixedDesign } from '../../__fixtures__/everyday-mixed-design';
import { createProject, DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import type * as GcodeModule from '../../io/gcode';

const compiles = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../io/gcode', async (importOriginal) => {
  const actual = await importOriginal<typeof GcodeModule>();
  return {
    ...actual,
    prepareOutput: (...args: Parameters<typeof actual.prepareOutput>) => {
      compiles.count += 1;
      return actual.prepareOutput(...args);
    },
  };
});

import { estimateLiveJob } from '../laser/live-job-estimate';
import { outputPreparationShouldRunOffThread } from '../laser/output-preparation-worker-client';
import {
  costlyCanvasPreparation,
  outputPreparationPrefersWorker,
} from './canvas-preparation-policy';
import { buildPreviewToolpath } from './draw-preview';

/** A browser window: one that can start workers (jsdom has none). */
function inAWindowWithWorkers(): void {
  vi.stubGlobal('Worker', vi.fn());
}

beforeEach(() => {
  compiles.count = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('everyday output preparation leaves the UI thread', () => {
  it('prepares the 200-object mix in a worker for every output action', () => {
    inAWindowWithWorkers();
    const mix = everydayMixedDesign(200);
    // Start, Frame and Save decide here; Preview and the estimate below.
    expect(outputPreparationShouldRunOffThread(mix, DEFAULT_OUTPUT_SCOPE)).toBe(true);
    expect(buildPreviewToolpath(mix, { outputScope: DEFAULT_OUTPUT_SCOPE }).previewIssue).toEqual({
      kind: 'too-complex',
    });
    expect(estimateLiveJob(mix, DEFAULT_OUTPUT_SCOPE)).toEqual({
      kind: 'too-large',
      ordinary: true,
    });
    // A Preview -> estimate -> Frame -> Start round compiles nothing here.
    expect(compiles.count).toBe(0);
  });

  it('keeps the Machine Setup and Design advisories on their own budget', () => {
    inAWindowWithWorkers();
    // They compile only, and go blank when routed away (canvas-preparation-policy.ts).
    expect(costlyCanvasPreparation(everydayMixedDesign(200))).toBe(false);
  });

  it('still prepares a tiny job here, where a worker round trip costs more', () => {
    inAWindowWithWorkers();
    const tiny = everydayMixedDesign(2);
    expect(outputPreparationPrefersWorker(tiny)).toBe(false);
    expect(buildPreviewToolpath(tiny).previewIssue).toBeUndefined();
    expect(compiles.count).toBe(1);
    expect(outputPreparationPrefersWorker(createProject())).toBe(false);
  });

  it('prepares the mix here, as before, when no worker can start', () => {
    const mix = everydayMixedDesign(200);
    expect(outputPreparationPrefersWorker(mix)).toBe(false);
    expect(buildPreviewToolpath(mix).previewIssue).toBeUndefined();
    expect(compiles.count).toBe(1);
  });
});
