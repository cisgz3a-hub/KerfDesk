import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type GcodeDialectId } from '../../core/devices';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { currentSaveGcodeContext } from '../app/save-gcode-context';
import { emitSaveGcode } from '../app/save-gcode-emission';
import { preparedJobReview } from '../remote-access/prepared-job-review';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { installFrameOnceProject } from './frame-once.test-support';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { currentOutputScope } from '../state/output-scope-state';
import { modelFor } from './job-review/job-review-gate';
import type * as OutputWorkerModule from './output-preparation-worker-client';
import * as source from './start-job-source';

// ADR-257 Amendment 3: the same island job through Save, Start and remote.

// Fills prepare in a worker in the app; that route calls the same advisories
// (output-preparation.ts), and tests have no worker.
vi.mock('./output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputWorkerModule>()),
  outputPreparationShouldRunOffThread: () => false,
}));

const COLOR = '#ff0000';

function installIslandJob(dialectId: GcodeDialectId): void {
  installFrameOnceProject();
  const polylines = Array.from({ length: 6 }, (_, index) => {
    const x = 20 + index * 2;
    const points = [
      { x, y: 20 },
      { x: x + 0.3, y: 20 },
      { x: x + 0.3, y: 23 },
      { x, y: 23 },
    ];
    return { points, closed: true };
  });
  useStore.setState({
    project: {
      ...createProject({
        ...DEFAULT_DEVICE_PROFILE,
        streamingMode: 'ping-pong',
        gcodeDialect: { dialectId },
      }),
      scene: {
        layers: [
          {
            ...createLayer({ id: COLOR, name: 'Small text', color: COLOR, mode: 'fill' }),
            fillStyle: 'island',
            fillOverscanMm: 0,
            speed: 1500,
          },
        ],
        objects: [
          {
            kind: 'imported-svg',
            id: 'bars',
            source: 'bars.svg',
            bounds: { minX: 20, minY: 20, maxX: 30.3, maxY: 23 },
            transform: IDENTITY_TRANSFORM,
            paths: [{ color: COLOR, polylines }],
          },
        ],
      },
    },
  });
  useCameraStore.setState({ placementActive: false, confirmedPositionEpoch: null });
}

function hasAdvice(warnings: ReadonlyArray<string>): boolean {
  return warnings.some((warning) =>
    warning.includes('Fill operation "Small text" burns with constant power (M3)'),
  );
}

async function saveWarnings(): Promise<ReadonlyArray<string>> {
  const saved = await emitSaveGcode(
    currentSaveGcodeContext({
      platform: {} as never,
      app: useStore.getState(),
      laser: useLaserStore.getState(),
      pushToast: vi.fn(),
    }),
    { ok: true },
  );
  if (saved.kind !== 'emitted') throw new Error(`Save refused: ${saved.kind}`);
  return saved.machineWarnings ?? [];
}

async function startWarnings(): Promise<ReadonlyArray<string>> {
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const camera = useCameraStore.getState();
  const prepared = await source.prepareCurrentStartJob(app, laser, camera, undefined, false);
  if (!prepared.ok) throw new Error(prepared.messages.join('; '));
  return modelFor({
    app,
    laser,
    project: app.project,
    prepared,
    laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
    outputScope: currentOutputScope(app),
    preparedMachineInputsKey: source.startMachineInputsKey(app.project, laser, camera),
  }).warnings;
}

async function remoteWarnings(): Promise<ReadonlyArray<string>> {
  const review = await preparedJobReview('island-review');
  return review.warnings.map((warning) => warning.message);
}

describe('island dose advice on every output route', () => {
  beforeEach(() => vi.restoreAllMocks());

  const routes = [
    ['Save G-code', saveWarnings],
    ['Start and Job Review', startWarnings],
    ['remote review', remoteWarnings],
  ] as const;

  it.each(routes)('%s advises GRBL Compatible', async (_route, warnings) => {
    installIslandJob('grbl-compatible');
    expect(hasAdvice(await warnings())).toBe(true);
  });

  it.each(routes)('%s stays quiet under GRBL Dynamic', async (_route, warnings) => {
    installIslandJob('grbl-dynamic');
    expect(hasAdvice(await warnings())).toBe(false);
  });
});
