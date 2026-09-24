import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { currentOutputScope, useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import {
  frameBoundsPreviewMatches,
  traceableFrameBoundsPreview,
  type FrameBoundsPreview,
} from './frame-bounds-preview';
import { idleControllerStatusForFrameTest } from './framed-run-testing';
import { hydrateTransferredStartPreparation } from './output-preparation-worker-client';
import { machineSnapshot } from './start-machine-snapshot';
import type { StartOutputPreparationRequest } from './output-preparation-protocol';

// The invariant a split Frame rests on (ADR-353): the outline a Start
// preparation reports as soon as the job is compiled is the outline its
// finished program carries in its metrics, to the emit precision the Frame
// verifies. Same functions, same compiled job, so equality is by
// construction — and this pins it through the real preparation.

function installVectorProject(): void {
  const base = createProject();
  useStore.setState({
    project: {
      ...base,
      scene: {
        ...EMPTY_SCENE,
        layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
        objects: [
          {
            kind: 'imported-svg',
            id: 'O1',
            source: 'preview.svg',
            bounds: { minX: 4, minY: 6, maxX: 24, maxY: 16 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: false,
                    points: [
                      { x: 4, y: 6 },
                      { x: 24, y: 16 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
  });
}

function startRequest(snapshot?: {
  readonly evaluatedAtIso: string;
}): StartOutputPreparationRequest {
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  return {
    kind: 'start',
    project: app.project,
    controllerSettings: laser.controllerSettings,
    machine: machineSnapshot(app.project, laser, useCameraStore.getState()),
    jobPlacement: app.jobPlacement,
    outputScope: currentOutputScope(app),
    requireFrame: false,
    ...(snapshot === undefined ? {} : { snapshot }),
  };
}

const bounds = { minX: 4, minY: 6, maxX: 24, maxY: 16 };

beforeEach(() => {
  installVectorProject();
  useLaserStore.setState({
    streamer: null,
    statusReport: idleControllerStatusForFrameTest(),
    alarmCode: null,
    motionOperation: null,
    controllerOperation: null,
    autofocusBusy: false,
    workOriginActive: false,
    wcoCache: null,
  });
});

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({ statusReport: null });
});

describe('frameBoundsPreview through the real Start preparation', () => {
  it.each([
    ['live compile', undefined],
    ['snapshot compile', { evaluatedAtIso: '2026-09-22T12:00:00.000Z' }],
  ] as const)(
    'reports the outline once, before the program, and the finished program reproduces it (%s)',
    async (_label, snapshot) => {
      const previews: FrameBoundsPreview[] = [];
      let programSeen = false;
      const response = await prepareOutputRequestForTest(startRequest(snapshot), {
        onFrameBounds: (preview) => {
          expect(programSeen).toBe(false);
          previews.push(preview);
        },
      });
      programSeen = true;
      if (response.kind !== 'start') throw new Error('Start preparation returned no job');
      const prepared = hydrateTransferredStartPreparation(response.result);
      if (!prepared.ok) throw new Error(prepared.messages.join(' '));

      expect(previews).toHaveLength(1);
      const preview = previews[0]!;
      expect(preview.retentionKey).toBe(prepared.canvasPlan.retentionKey);
      expect(preview.frameJobBounds).toEqual(prepared.metrics.frameJobBounds);
      expect(preview.frameMotionBounds).toEqual(prepared.metrics.frameMotionBounds);
      expect(frameBoundsPreviewMatches(preview, prepared)).toBe(true);
      expect(traceableFrameBoundsPreview(preview)).not.toBeNull();
    },
  );
});

describe('frameBoundsPreviewMatches', () => {
  const prepared = (retentionKey: string, motion: typeof bounds | null) => ({
    canvasPlan: { retentionKey },
    metrics: { frameJobBounds: bounds, frameMotionBounds: motion },
  });
  const preview: FrameBoundsPreview = {
    frameJobBounds: bounds,
    frameMotionBounds: bounds,
    retentionKey: 'key-a',
  };

  it('accepts the same rectangles to emit precision and refuses any other job or envelope', () => {
    expect(frameBoundsPreviewMatches(preview, prepared('key-a', bounds))).toBe(true);
    expect(
      frameBoundsPreviewMatches(preview, prepared('key-a', { ...bounds, maxX: 24.0004 })),
    ).toBe(true);
    expect(frameBoundsPreviewMatches(preview, prepared('key-b', bounds))).toBe(false);
    expect(frameBoundsPreviewMatches(preview, prepared('key-a', { ...bounds, maxX: 24.002 }))).toBe(
      false,
    );
    expect(frameBoundsPreviewMatches(preview, prepared('key-a', null))).toBe(false);
  });
});

describe('traceableFrameBoundsPreview', () => {
  it('needs a finite burn rectangle and falls back to it for the envelope', () => {
    expect(traceableFrameBoundsPreview(null)).toBeNull();
    expect(
      traceableFrameBoundsPreview({
        frameJobBounds: null,
        frameMotionBounds: null,
        retentionKey: 'k',
      }),
    ).toBeNull();
    expect(
      traceableFrameBoundsPreview({
        frameJobBounds: { ...bounds, maxX: Number.NaN },
        frameMotionBounds: bounds,
        retentionKey: 'k',
      }),
    ).toBeNull();
    expect(
      traceableFrameBoundsPreview({
        frameJobBounds: bounds,
        frameMotionBounds: { ...bounds, minY: Number.NEGATIVE_INFINITY },
        retentionKey: 'k',
      }),
    ).toBeNull();
    expect(
      traceableFrameBoundsPreview({
        frameJobBounds: bounds,
        frameMotionBounds: null,
        retentionKey: 'k',
      }),
    ).toEqual({ frameJobBounds: bounds, frameMotionBounds: bounds, retentionKey: 'k' });
  });
});
