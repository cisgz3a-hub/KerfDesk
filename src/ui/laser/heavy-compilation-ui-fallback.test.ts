import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mixedCanvasCompilationProject } from '../../__fixtures__/mixed-canvas-compilation-project';
import type * as GcodeModule from '../../io/gcode';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Project,
} from '../../core/scene';
import { DEFAULT_JOB_PLACEMENT, resolveExportJobPlacement } from '../job-placement';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import type * as OutputWorkerModule from './output-preparation-worker-client';
import type * as StartReadinessModule from './start-job-readiness';

const workerMocks = vi.hoisted(() => ({
  prepareStart: vi.fn(),
  prepareSave: vi.fn(),
  prepareSnapshot: vi.fn(),
  prepareStartSnapshot: vi.fn(),
  shouldRun: vi.fn(),
}));

vi.mock('./output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputWorkerModule>()),
  outputPreparationShouldRunOffThread: workerMocks.shouldRun,
  prepareStartOutputOffThread: workerMocks.prepareStart,
  prepareSaveOutputOffThread: workerMocks.prepareSave,
}));

vi.mock('./start-job-readiness', async (importOriginal) => ({
  ...(await importOriginal<typeof StartReadinessModule>()),
  prepareStartJobSnapshot: workerMocks.prepareStartSnapshot,
}));

vi.mock('../../io/gcode', async (importOriginal) => ({
  ...(await importOriginal<typeof GcodeModule>()),
  prepareOutputSnapshot: workerMocks.prepareSnapshot,
}));

import { emitSaveGcode } from '../app/save-gcode-emission';
import { handleInspectCurrentGcode } from '../app/inspect-current-gcode-action';
import { prepareCurrentStartJob } from './start-job-source';

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  workerMocks.prepareStart.mockReset();
  workerMocks.prepareSave.mockReset();
  workerMocks.prepareSnapshot.mockReset();
  workerMocks.prepareStartSnapshot.mockReset();
  workerMocks.shouldRun.mockReset().mockReturnValue(true);
});

describe('heavy preparation failure never falls back to the UI thread', () => {
  it.each(['unavailable', 'crashed'] as const)(
    'keeps Start off-thread when worker is %s',
    async (failure) => {
      const project = vcarveProject();
      useStore.setState({ project });
      workerMocks.prepareStart.mockReturnValue(
        failure === 'unavailable' ? null : Promise.reject(new Error('worker crashed')),
      );

      const result = await prepareCurrentStartJob(
        useStore.getState(),
        useLaserStore.getState(),
        useCameraStore.getState(),
      );

      expect(result).toMatchObject({ ok: false });
      expect(workerMocks.prepareStartSnapshot).not.toHaveBeenCalled();
    },
  );

  it.each(['unavailable', 'crashed'] as const)(
    'keeps Save off-thread when worker is %s',
    async (failure) => {
      const project = vcarveProject();
      workerMocks.prepareSave.mockReturnValue(
        failure === 'unavailable' ? null : Promise.reject(new Error('worker crashed')),
      );
      const placement = resolveExportJobPlacement(DEFAULT_JOB_PLACEMENT, {
        statusReport: null,
        workOriginActive: false,
        wcoCache: null,
      });
      if (!placement.ok) throw new Error('fixture placement failed');

      const result = await emitSaveGcode(
        {
          platform: {} as never,
          project,
          savedName: null,
          pushToast: () => undefined,
        },
        placement,
      );

      expect(result.kind).toBe('preparation-unavailable');
      expect(workerMocks.prepareSnapshot).not.toHaveBeenCalled();
    },
  );

  it('routes a low-input variable snapshot to the worker before rendered geometry can expand', async () => {
    const project = variableTextProject();
    useStore.setState({ project });
    workerMocks.shouldRun.mockReturnValue(false);
    workerMocks.prepareStart.mockReturnValue(null);
    workerMocks.prepareSave.mockReturnValue(null);
    const placement = resolveExportJobPlacement(DEFAULT_JOB_PLACEMENT, {
      statusReport: null,
      workOriginActive: false,
      wcoCache: null,
    });
    if (!placement.ok) throw new Error('fixture placement failed');

    const start = await prepareCurrentStartJob(
      useStore.getState(),
      useLaserStore.getState(),
      useCameraStore.getState(),
    );
    const save = await emitSaveGcode(
      {
        platform: {} as never,
        project,
        savedName: null,
        pushToast: () => undefined,
      },
      placement,
    );

    expect(start.ok).toBe(false);
    expect(save.kind).toBe('preparation-unavailable');
    expect(workerMocks.prepareStart).toHaveBeenCalledOnce();
    expect(workerMocks.prepareSave).toHaveBeenCalledOnce();
    expect(workerMocks.prepareStartSnapshot).not.toHaveBeenCalled();
    expect(workerMocks.prepareSnapshot).not.toHaveBeenCalled();
  });

  it('keeps the mixed viewer compile in the shared worker and forwards progress and cancellation', async () => {
    const project = mixedCanvasCompilationProject();
    const controller = new AbortController();
    const onProgress = vi.fn();
    const openInspector = vi.fn();
    workerMocks.prepareSave.mockImplementation(
      (_request: unknown, receivedProgress: unknown, signal: unknown) => {
        expect(receivedProgress).toBe(onProgress);
        expect(signal).toBe(controller.signal);
        return Promise.resolve({
          kind: 'emitted' as const,
          gcode: 'G21\nG90\n',
          preflight: { ok: true as const, issues: [] },
          cncVCarveDepths: [],
        });
      },
    );

    const result = await handleInspectCurrentGcode(
      {
        platform: {} as never,
        project,
        savedName: 'mixed-viewer',
        pushToast: () => undefined,
      },
      openInspector,
      { signal: controller.signal, onProgress },
    );

    expect(result).toEqual({ kind: 'ready' });
    expect(workerMocks.prepareSave).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'save', project }),
      onProgress,
      controller.signal,
    );
    expect(openInspector).toHaveBeenCalledWith('mixed-viewer (current canvas)', 'G21\nG90\n');
    expect(workerMocks.prepareSnapshot).not.toHaveBeenCalled();
  });
});

function vcarveProject(): Project {
  const color = '#7c3aed';
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: [],
      layers: [
        {
          ...createLayer({ id: 'vcarve', color }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' },
        },
      ],
    },
  };
}

function variableTextProject(): Project {
  const project = createProject();
  const color = '#111111';
  return {
    ...project,
    scene: {
      objects: [
        {
          kind: 'text',
          id: 'variable',
          content: 'tiny',
          variableTemplate: { tokens: [{ kind: 'csv', column: 'payload' }] },
          fontKey: 'dancing-script-regular',
          sizeMm: 10,
          alignment: 'left',
          lineHeight: 1.2,
          letterSpacing: 0,
          color,
          bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
          transform: IDENTITY_TRANSFORM,
          paths: [],
        },
      ],
      layers: [{ ...createLayer({ id: 'variable-layer', color }), mode: 'line' }],
    },
  };
}
