import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import { createLayerSubLayer } from '../../core/scene';
import { inferCurrentMachinePosition } from '../state/infer-machine-position';
import { disconnectOnTestClock } from '../state/laser-disconnect-testing';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { centreSelectionLight } from './centre-selection-light';
import { connectedFixture } from './frame-artwork-centre-led.test-support';
import type * as OutputPreparationWorker from './output-preparation-worker-client';
import { runFrameNow } from './use-frame-action';

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

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetStore();
  useLaserStore.setState(initialLaserState());
  useToastStore.setState({ toasts: [] });
});
afterEach(async () => {
  await disconnectOnTestClock();
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function frame() {
  const pending = runFrameNow();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await pending, JSON.stringify(useToastStore.getState().toasts)).toBe(true);
  const permit = useLaserStore.getState().framedRun;
  expect(permit).not.toBeNull();
  return permit!;
}

async function centre(ids: ReadonlyArray<string>) {
  const pending = centreSelectionLight(ids);
  await vi.advanceTimersByTimeAsync(5_000);
  await pending;
}

async function expectOutputRejected(ids: ReadonlyArray<string>) {
  const result = centreSelectionLight(ids).then(
    () => null,
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await result).toBeInstanceOf(Error);
  expect(await result).toMatchObject({
    message: expect.stringMatching(/not included.*Frame|output/i),
  });
}

async function mixedPathFixture(
  mode: 'absolute' | 'user-origin' | 'verified-origin' | 'current-position',
) {
  const fixture = await connectedFixture('grbl-v1.1', mode);
  const { project } = fixture;
  useStore.setState({
    project: {
      ...project,
      scene: {
        ...project.scene,
        objects: project.scene.objects.map((object) =>
          object.id === 'selected' && object.kind === 'imported-svg'
            ? {
                ...object,
                bounds: { minX: 30, minY: 40, maxX: 140, maxY: 130 },
                paths: [
                  ...object.paths,
                  {
                    color: project.scene.layers[0]!.color,
                    operationIds: ['disabled'],
                    polylines: [
                      {
                        closed: false,
                        points: [
                          { x: 120, y: 120 },
                          { x: 140, y: 130 },
                        ],
                      },
                    ],
                  },
                ],
              }
            : object,
        ),
      },
    },
  });
  return fixture;
}

describe('selected LED target belongs to the framed output', () => {
  it.each(['absolute', 'user-origin', 'verified-origin', 'current-position'] as const)(
    '%s centres only the enabled path inside one mixed-output imported artwork',
    async (mode) => {
      const { project } = await mixedPathFixture(mode);
      const permit = await frame();
      await centre(['selected']);
      const laser = useLaserStore.getState();
      const head = inferCurrentMachinePosition(laser.statusReport, laser.wcoCache);
      // The enabled path is 30..50 by 40..50; its disabled sibling is 120..140 by 120..130.
      // Frame's whole output remains 30..80 by 40..70, so placement must remain unchanged.
      expect(head).toMatchObject(
        mode === 'absolute'
          ? { x: 33, y: project.device.bedHeight - 49 }
          : mode === 'current-position'
            ? { x: 178, y: 116 }
            : { x: 103, y: 71 },
      );
      expect(laser.framedRun?.candidate).toBe(permit.candidate);
      expect(laser.positioningLightEnabled).toBe(true);
    },
  );

  it('retains the whole-artwork canvas centre for a direct Absolute action before Frame', async () => {
    const { project } = await mixedPathFixture('absolute');
    await centre(['selected']);
    const laser = useLaserStore.getState();
    expect(inferCurrentMachinePosition(laser.statusReport, laser.wcoCache)).toMatchObject({
      x: 78,
      y: project.device.bedHeight - 89,
    });
  });

  it.each(['absolute', 'user-origin', 'verified-origin', 'current-position'] as const)(
    '%s rejects visible artwork bound only to disabled output',
    async (mode) => {
      const { sim } = await connectedFixture('grbl-v1.1', mode);
      const permit = await frame();
      const scene = permit.candidate.preparedStart.prepared.project.scene;
      // Preparation retains non-output artwork; presence alone cannot prove it was framed.
      expect(scene.objects.some((object) => object.id === 'disabled')).toBe(true);
      expect(scene.layers.find((layer) => layer.id === 'disabled')?.visible).toBe(true);
      useStore.setState({ selectedObjectId: 'disabled', additionalSelectedIds: new Set() });
      const firstWrite = sim.outbound().length;
      await expectOutputRejected(['disabled']);
      expect(
        sim
          .outbound()
          .slice(firstWrite)
          .filter((payload) => payload !== '?'),
      ).toEqual([]);
      expect(useLaserStore.getState().positioningLightEnabled).toBe(false);
      expect(useLaserStore.getState().framedRun).toBe(permit);
    },
  );

  it('rejects a chosen group containing a non-output member without silently shrinking it', async () => {
    const { sim } = await connectedFixture('grbl-v1.1', 'user-origin');
    const permit = await frame();
    useStore.setState({ additionalSelectedIds: new Set(['disabled']) });
    const firstWrite = sim.outbound().length;
    await expectOutputRejected(['selected', 'disabled']);
    expect(
      sim
        .outbound()
        .slice(firstWrite)
        .filter((payload) => payload !== '?'),
    ).toEqual([]);
    expect(useLaserStore.getState().framedRun).toBe(permit);
  });

  it('retains objects with explicit enabled bindings even when their colour matches disabled output', async () => {
    const { project } = await connectedFixture('grbl-v1.1', 'user-origin');
    useStore.setState({
      project: {
        ...project,
        scene: {
          ...project.scene,
          objects: project.scene.objects.map((object) =>
            object.id === 'disabled' ? { ...object, operationIds: ['disabled', 'output'] } : object,
          ),
        },
      },
    });
    const permit = await frame();
    useStore.setState({ selectedObjectId: 'disabled', additionalSelectedIds: new Set() });
    await centre(['disabled']);
    expect(useLaserStore.getState().positioningLightEnabled).toBe(true);
    expect(useLaserStore.getState().framedRun?.candidate).toBe(permit.candidate);
  });

  it.each([false, true])(
    'honours a vector sub-operation enabled=%s on an image parent',
    async (enabled) => {
      const { project, sim } = await connectedFixture('grbl-v1.1', 'user-origin');
      const layer = project.scene.layers.find((operation) => operation.id === 'disabled')!;
      useStore.setState({
        project: {
          ...project,
          scene: {
            ...project.scene,
            layers: project.scene.layers.map((operation) =>
              operation.id === layer.id
                ? {
                    ...operation,
                    mode: 'image',
                    output: true,
                    subLayers: [
                      createLayerSubLayer(layer, { id: 'vector', label: 'Vector', enabled }),
                    ],
                  }
                : operation,
            ),
          },
        },
      });
      const permit = await frame();
      useStore.setState({ selectedObjectId: 'disabled', additionalSelectedIds: new Set() });
      if (enabled) {
        await centre(['disabled']);
        expect(useLaserStore.getState().positioningLightEnabled).toBe(true);
        expect(useLaserStore.getState().framedRun?.candidate).toBe(permit.candidate);
      } else {
        const firstWrite = sim.outbound().length;
        await expectOutputRejected(['disabled']);
        expect(
          sim
            .outbound()
            .slice(firstWrite)
            .filter((payload) => payload !== '?'),
        ).toEqual([]);
      }
    },
  );
});
