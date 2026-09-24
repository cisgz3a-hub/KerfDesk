// Audit: real host connect -> jog -> origin -> Frame -> Start against a scripted
// controller. The A1 command dialect is exercised, not its physical firmware.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import {
  FALCON_A1_PRO_GRBLHAL_PROFILE,
  FALCON_COMPATIBLE_PROFILE,
} from '../../core/devices/falcon-profiles';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { connectOptionsForDevice } from '../commands/connect-options';
import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { resetStore } from '../state/test-helpers';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { runFrameNow } from './use-frame-action';
import { runStartJobFlow } from './start-job-flow';
import type * as OutputPreparationWorker from './output-preparation-worker-client';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));
vi.mock('./output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputPreparationWorker>()),
  prepareStartOutputOffThread: async (
    request: Parameters<typeof prepareOutputRequestForTest>[0],
  ) => {
    const response = await prepareOutputRequestForTest(request);
    if (response.kind !== 'start') throw new Error('Expected start preparation');
    return response.result;
  },
}));

let disposeReview: () => void = () => undefined;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetStore();
  useLaserStore.setState(initialLaserState());
  disposeReview = installAutoJobReview('confirm');
});
afterEach(async () => {
  disposeReview();
  useJobReviewStore.getState().close();
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

describe.each([FALCON_COMPATIBLE_PROFILE, FALCON_A1_PRO_GRBLHAL_PROFILE])(
  'Falcon coordinate flow: $name',
  (device) => {
    it.each([
      'absolute',
      'absolute-offset',
      'current-position',
      'user-origin',
      'verified-origin',
    ] as const)(
      '%s preserves the physical anchor through Frame and streams its exact program',
      async (scenario) => {
        const startFrom = scenario === 'absolute-offset' ? 'absolute' : scenario;
        const base = createProject(device);
        const project = {
          ...base,
          scene: {
            ...EMPTY_SCENE,
            layers: [{ ...createLayer({ id: 'audit-line', color: '#ff0000' }), power: 10 }],
            objects: [
              {
                kind: 'imported-svg' as const,
                id: 'audit-artwork',
                source: 'audit.svg',
                transform: IDENTITY_TRANSFORM,
                bounds: { minX: 30, minY: 40, maxX: 50, maxY: 50 },
                paths: [
                  {
                    color: '#ff0000',
                    polylines: [
                      {
                        closed: false,
                        points: [
                          { x: 30, y: 40 },
                          { x: 50, y: 50 },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        };
        useStore.setState({ project, jobPlacement: { startFrom, anchor: 'center' } });
        const sim = createGrblSimulator({ motionMs: 25, settings: [[32, '1']] });
        await useLaserStore.getState().connect(sim.adapter, connectOptionsForDevice(device));
        await vi.advanceTimersByTimeAsync(1500);
        await useLaserStore.getState().jog({ dx: 120, dy: 80, feed: 1000 });
        await vi.advanceTimersByTimeAsync(1500);
        expect(sim.state().mpos).toEqual({ x: 120, y: 80, z: 0 });

        if (
          startFrom === 'user-origin' ||
          startFrom === 'verified-origin' ||
          scenario === 'absolute-offset'
        ) {
          const settingOrigin = useLaserStore.getState().setOriginHere();
          await vi.advanceTimersByTimeAsync(1500);
          await settingOrigin;
          expect(sim.state().g92).toEqual({ x: 120, y: 80, z: 0 });
        }

        const frameWriteIndex = sim.outbound().length;
        const framing = runFrameNow();
        await vi.advanceTimersByTimeAsync(12000);
        expect(await framing).toBe(true);
        expect(sim.state().mpos).toEqual({ x: 120, y: 80, z: 0 });
        const frameLines = sim.outbound().slice(frameWriteIndex).join('').split('\n');
        expect(frameLines.some((line) => /\bM[34]\b/.test(line))).toBe(false);
        const permit = useLaserStore.getState().framedRun;
        expect(permit).not.toBeNull();
        if (permit === null) throw new Error('Frame issued no permit');
        const bounds = permit.candidate.preparedStart.metrics.frameJobBounds;
        const expected =
          scenario === 'absolute-offset'
            ? { minX: -90, maxX: -70, minY: device.bedHeight - 130, maxY: device.bedHeight - 120 }
            : startFrom === 'absolute'
              ? { minX: 30, maxX: 50, minY: device.bedHeight - 50, maxY: device.bedHeight - 40 }
              : startFrom === 'current-position'
                ? { minX: 110, maxX: 130, minY: 75, maxY: 85 }
                : { minX: -10, maxX: 10, minY: -5, maxY: 5 };
        expect(bounds).toEqual(expected);
        if (scenario === 'absolute-offset') {
          expect(sim.state().g92).toEqual({ x: 120, y: 80, z: 0 });
          expect(bounds!.minX + 120).toBe(30);
          expect(bounds!.minY + 80).toBe(device.bedHeight - 50);
          expect(frameLines.some((line) => /G92|G10/.test(line))).toBe(false);
        }

        const repository = new RecoveryRepository({
          backend: new MemoryRecoveryStorageBackend(),
          generationStore: new MemoryRecoveryGenerationStore(),
          legacyStorage: { read: () => null, clear: () => undefined },
          nowIso: () => '2026-09-21T12:00:00.000Z',
        });
        const startWriteIndex = sim.outbound().length;
        const starting = runStartJobFlow(repository);
        await vi.advanceTimersByTimeAsync(12000);
        await starting;
        await vi.advanceTimersByTimeAsync(5000);
        // GRBL drops realtime bytes before its line buffer: the '?' status
        // polls and the 0x80+ override resets a laser Start sends first (ADR-355).
        const wire = [...sim.outbound().slice(startWriteIndex).join('')]
          .filter((character) => character !== '?' && character.charCodeAt(0) < 0x80)
          .join('');
        const expectedCommands = permit.candidate.preparedStart.gcode
          .split(/\r?\n/)
          .map((line) =>
            line
              .replace(/\([^)]*\)/g, '')
              .split(';')[0]!
              .trim(),
          )
          .filter(Boolean);
        const sentCommands = wire
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const streamStart = sentCommands.findIndex(
          (command, index) =>
            command === expectedCommands[0] &&
            expectedCommands.every(
              (expectedCommand, offset) => sentCommands[index + offset] === expectedCommand,
            ),
        );
        expect(
          streamStart,
          'The entire prepared program must appear contiguously on the wire',
        ).toBeGreaterThanOrEqual(0);
        expect(useLaserStore.getState().lastWriteError).toBeNull();
        expect(sim.state().machine).toBe('Idle');
        expect(sim.state().spindle).toBe(0);
        expect(useLaserStore.getState().framedRun).toBeNull();
      },
    );
  },
);
