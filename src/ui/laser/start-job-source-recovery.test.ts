import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import type { JobOriginPlacement } from '../../core/job';
import { fingerprintGcode } from '../../core/recovery';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type OutputScope,
  type Project,
} from '../../core/scene';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { currentOutputScope, useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { createExecutionArtifact } from '../state/recovery';
import { resetStore } from '../state/test-helpers';
import { isCanvasCompilationBridgeConnection } from '../workspace/canvas-compilation-worker-protocol';
import { prepareOutputRequest } from './output-preparation';
import type {
  OutputPreparationEnvelope,
  OutputPreparationResponse,
  OutputPreparationResult,
} from './output-preparation-protocol';
import {
  BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE,
  outputPreparationShouldRunOffThread,
  resetOutputPreparationWorkerForTests,
} from './output-preparation-worker-client';
import * as readiness from './start-job-readiness';
import { prepareArchivedRecoverySource, prepareRecoverySource } from './start-job-source';
import { STALE_START_PREPARATION_MESSAGE } from './start-preparation-owner';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: MessageEvent<OutputPreparationResult>) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: OutputPreparationEnvelope[] = [];
  terminated = false;
  constructor() {
    ControlledWorker.instances.push(this);
  }
  postMessage(value: unknown): void {
    if (!isCanvasCompilationBridgeConnection(value)) {
      this.posted.push(value as OutputPreparationEnvelope);
    }
  }
  terminate(): void {
    this.terminated = true;
  }
  respond(response: OutputPreparationResponse): void {
    this.onmessage?.({
      data: { requestId: this.posted.at(-1)?.requestId, response },
    } as MessageEvent<OutputPreparationResult>);
  }
  async compile(): Promise<void> {
    const request = this.posted.at(-1)?.request;
    if (request === undefined) throw new Error('No background recovery request.');
    this.respond(await prepareOutputRequest(request));
  }
}

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 190, y: 180, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};
const controllerSettings = { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true };
const savedScope: OutputScope = {
  cutSelectedGraphics: true,
  useSelectionOrigin: true,
  selectedObjectIds: ['B'],
};
const savedOrigin: JobOriginPlacement = {
  startFrom: 'current-position',
  anchor: 'front-left',
  currentPosition: { x: 45, y: 60 },
};
const latestWorker = () => ControlledWorker.instances.at(-1)!;

beforeEach(() => {
  resetStore();
  resetOutputPreparationWorkerForTests();
  ControlledWorker.instances = [];
  vi.stubGlobal('Worker', ControlledWorker);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.mocked(jobAwareAlert).mockClear();
  useStore.setState({
    project: recoveryProject(),
    selectedObjectId: 'A',
    outputScopeSettings: { cutSelectedGraphics: true, useSelectionOrigin: false },
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    controllerSessionEpoch: 3,
    controllerQualification: { kind: 'qualified', epoch: 3, settings: 'verified' },
    statusReport: idleStatus,
    controllerSettings,
    detectedControllerKind: 'grbl-v1.1',
  });
  useCameraStore.setState({ placementActive: false, confirmedPositionEpoch: null });
});

afterEach(() => {
  resetOutputPreparationWorkerForTests();
  useLaserStore.setState(initialLaserState());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('recovery source preparation', () => {
  it('preserves small-job bytes, saved selection and frozen origin without a new Frame', async () => {
    const expected = directPreparation(savedScope, savedOrigin);
    const recovered = await prepareRecoverySource({
      outputScope: savedScope,
      jobOrigin: savedOrigin,
    });

    expect(recovered?.gcode).toBe(expected.gcode);
    expect(recovered?.jobOrigin).toEqual(savedOrigin);
    expect(recovered?.prepared.project.scene.objects.map((object) => object.id)).toEqual(['B']);
    expect(recovered?.canvasPlan.fingerprint).toEqual(fingerprintGcode(expected.gcode));
    expect(ControlledWorker.instances).toHaveLength(0);
    expect(jobAwareAlert).not.toHaveBeenCalled();
  });

  it('treats an absent saved origin as Absolute even if live placement changed', async () => {
    const expected = directPreparation(savedScope);
    useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'center' } });

    const recovered = await prepareRecoverySource({ outputScope: savedScope });

    expect(recovered?.gcode).toBe(expected.gcode);
    expect(recovered?.jobOrigin).toBeUndefined();
  });

  it('keeps current canvas placement for manual start-from-line preparation', async () => {
    useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'center' } });
    const recovered = await prepareRecoverySource();

    expect(recovered?.jobOrigin).toEqual({
      startFrom: 'current-position',
      anchor: 'center',
      currentPosition: { x: 190, y: 180 },
    });
    expect(recovered?.prepared.project.scene.objects.map((object) => object.id)).toEqual(['A']);
  });

  it('qualifies exact archived recovery after reconnect with no retained Frame', () => {
    const prepared = directPreparation(savedScope, savedOrigin);
    const artifact = createExecutionArtifact({
      artifactSchemaVersion: 1,
      runId: 'recovery-source-archive',
      gcode: prepared.gcode,
      prepared: prepared.prepared,
      outputScope: savedScope,
      jobOrigin: savedOrigin,
      canvasPlan: prepared.canvasPlan,
      controllerSettings,
      createdAtIso: '2026-09-21T00:00:00.000Z',
    });

    const qualifiedAgainst = useLaserStore.getState();
    const recovered = prepareArchivedRecoverySource(artifact);

    expect(recovered?.gcode).toBe(artifact.gcode);
    expect(recovered?.canvasPlan).toBe(artifact.canvasPlan);
    expect(recovered?.controllerSnapshot).toBe(qualifiedAgainst);
    expect(jobAwareAlert).not.toHaveBeenCalled();
  });

  it('compiles costly recovery in the worker with the exact saved scope and origin', async () => {
    useStore.setState({ project: recoveryProject(true) });
    const expected = directPreparation(savedScope, savedOrigin);
    const synchronousCompile = vi.spyOn(readiness, 'prepareStartJob');
    expect(outputPreparationShouldRunOffThread(useStore.getState().project, savedScope)).toBe(true);

    const pending = prepareRecoverySource({ outputScope: savedScope, jobOrigin: savedOrigin });
    const worker = latestWorker();
    expect(worker.posted[0]?.request).toMatchObject({
      kind: 'start',
      outputScope: savedScope,
      resolvedJobOrigin: savedOrigin,
      requireFrame: false,
    });
    expect(worker.posted[0]?.request).not.toHaveProperty('snapshot');
    await worker.compile();
    const recovered = await pending;

    expect(recovered?.gcode).toBe(expected.gcode);
    expect(recovered?.canvasPlan.fingerprint).toEqual(fingerprintGcode(expected.gcode));
    expect(synchronousCompile).not.toHaveBeenCalled();
    expect(jobAwareAlert).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'crash', 'compiler'] as const)(
    'reports a %s worker failure without blocking fallback compilation',
    async (failure) => {
      useStore.setState({ project: recoveryProject(true) });
      const synchronousCompile = vi.spyOn(readiness, 'prepareStartJob');
      if (failure === 'unavailable') vi.stubGlobal('Worker', undefined);

      const pending = prepareRecoverySource();
      if (failure === 'crash') latestWorker().onerror?.();
      if (failure === 'compiler') {
        latestWorker().respond({ kind: 'error', message: 'Cannot compile this geometry.' });
      }

      await expect(pending).resolves.toBeNull();
      expect(synchronousCompile).not.toHaveBeenCalled();
      expect(jobAwareAlert).toHaveBeenCalledWith(
        expect.stringContaining(
          failure === 'unavailable'
            ? BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE
            : failure === 'crash'
              ? 'worker errored'
              : 'Cannot compile this geometry.',
        ),
      );
    },
  );

  it.each(['project', 'placement', 'scope', 'session', 'position'] as const)(
    'cancels pending recovery when its %s changes',
    async (changed) => {
      useStore.setState({ project: recoveryProject(true) });
      const pending = prepareRecoverySource({ outputScope: savedScope, jobOrigin: savedOrigin });
      const worker = latestWorker();
      switch (changed) {
        case 'project':
          useStore.setState({ project: recoveryProject() });
          break;
        case 'placement':
          useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'center' } });
          break;
        case 'scope':
          useStore.setState({ selectedObjectId: 'B' });
          break;
        case 'session':
          useLaserStore.setState({ controllerSessionEpoch: 4 });
          break;
        case 'position':
          useLaserStore.setState({
            statusReport: { ...idleStatus, mPos: { x: 195, y: 180, z: 0 } },
          });
          break;
      }

      await expect(pending).resolves.toBeNull();
      expect(worker.terminated).toBe(true);
      expect(jobAwareAlert).toHaveBeenCalledWith(
        expect.stringContaining(STALE_START_PREPARATION_MESSAGE),
      );
    },
  );

  it('preserves background preparation across UI-only changes and unchanged status reports', async () => {
    useStore.setState({ project: recoveryProject(true) });
    const qualifiedAgainst = useLaserStore.getState();
    const pending = prepareRecoverySource();
    const worker = latestWorker();
    useStore.setState({ previewMode: true });
    useLaserStore.setState({ statusReport: { ...idleStatus, mPos: { ...idleStatus.mPos! } } });

    expect(worker.terminated).toBe(false);
    await worker.compile();
    const recovered = await pending;
    expect(recovered).not.toBeNull();
    expect(recovered?.controllerSnapshot).toBe(qualifiedAgainst);
    expect(recovered?.controllerSnapshot).not.toBe(useLaserStore.getState());
  });

  it.each(['settings', 'observation'] as const)(
    'rejects a refreshed controller %s observation instead of adopting it after the worker',
    async (changed) => {
      useStore.setState({ project: recoveryProject(true) });
      const pending = prepareRecoverySource();
      const worker = latestWorker();
      if (changed === 'settings') {
        useLaserStore.setState({ controllerSettings: { ...controllerSettings, maxPowerS: 2000 } });
      } else {
        useLaserStore.setState({
          controllerSettingsObservation: { sessionEpoch: 3, observedAt: 2 },
        });
      }

      // Ordinary Start ownership leaves advisory refreshes alone. Recovery
      // must additionally bind its source to the original qualification.
      expect(worker.terminated).toBe(false);
      await worker.compile();
      await expect(pending).resolves.toBeNull();
      expect(jobAwareAlert).toHaveBeenCalledWith(
        expect.stringContaining(STALE_START_PREPARATION_MESSAGE),
      );
    },
  );

  it('requires current-session controller qualification before dispatching recovery', async () => {
    useStore.setState({ project: recoveryProject(true) });
    useLaserStore.setState({ controllerSessionEpoch: 4 });

    await expect(prepareRecoverySource()).resolves.toBeNull();
    expect(ControlledWorker.instances).toHaveLength(0);
    expect(jobAwareAlert).toHaveBeenCalledWith(expect.stringContaining('fresh qualification'));
  });

  it('requires controller qualification to remain complete when the worker finishes', async () => {
    useStore.setState({ project: recoveryProject(true) });
    const pending = prepareRecoverySource();
    const worker = latestWorker();
    useLaserStore.setState({
      controllerQualification: { kind: 'qualifying', epoch: 3, phase: 'settings-read' },
    });

    await worker.compile();
    await expect(pending).resolves.toBeNull();
    expect(jobAwareAlert).toHaveBeenCalledWith(expect.stringContaining('fresh qualification'));
  });
});

function directPreparation(
  scope = currentOutputScope(useStore.getState()),
  origin?: JobOriginPlacement,
) {
  const prepared = readiness.prepareStartJob(
    useStore.getState().project,
    controllerSettings,
    { statusReport: idleStatus, alarmCode: null, hasActiveStreamer: false },
    DEFAULT_JOB_PLACEMENT,
    scope,
    origin,
    false,
  );
  if (!prepared.ok) throw new Error(prepared.messages.join('\n'));
  return prepared;
}

function recoveryProject(costly = false): Project {
  return {
    ...createProject(),
    scene: {
      objects: [square('A', 10), square('B', 90)],
      layers: [
        {
          ...createLayer({ id: 'red', color: '#ff0000' }),
          ...(costly ? ({ mode: 'fill', fillStyle: 'offset', hatchSpacingMm: 1 } as const) : {}),
        },
      ],
    },
  };
}

function square(id: string, x: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 10, maxX: x + 4, maxY: 14 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x, y: 10 },
              { x: x + 4, y: 10 },
              { x: x + 4, y: 14 },
              { x, y: 14 },
            ],
          },
        ],
      },
    ],
  };
}
