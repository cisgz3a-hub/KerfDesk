import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_OUTPUT_SCOPE,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { createExecutionArtifact, type ExecutionArtifactV1 } from '../state/recovery';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { deriveCncArtifactPassSpans } from './cnc-pass-span-derivation';
import { prepareCurrentStartJob } from './start-job-source';

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};
const lineObject: SceneObject = {
  kind: 'imported-svg',
  id: 'line-object',
  source: 'line.svg',
  bounds: { minX: 10, minY: 10, maxX: 70, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
            { x: 50, y: 10 },
            { x: 70, y: 10 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

async function archivedCncArtifact(): Promise<ExecutionArtifactV1> {
  useStore.setState({
    project: {
      ...createProject(DEFAULT_DEVICE_PROFILE),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: {
        ...EMPTY_SCENE,
        objects: [lineObject],
        layers: [createLayer({ id: 'red', color: '#ff0000' })],
      },
    },
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: idleStatus,
    controllerSettings: { maxPowerS: 12_000, minPowerS: 0, laserModeEnabled: false },
    controllerQualification: { kind: 'qualified', epoch: 0, settings: 'verified' },
    ovCache: { feed: 100, rapid: 100, spindle: 100 },
    accessoryCache: { spindleCw: false, spindleCcw: false, flood: false, mist: false },
    workZReferenceEpoch: 7,
    workZZeroEvidence: {
      source: 'manual-zero',
      referenceEpoch: 7,
      toolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
    },
  });
  const laser = useLaserStore.getState();
  const prepared = await prepareCurrentStartJob(
    useStore.getState(),
    laser,
    useCameraStore.getState(),
  );
  if (!prepared.ok) throw new Error(`Expected ready CNC job: ${prepared.messages.join('; ')}`);
  return createExecutionArtifact({
    runId: 'run-derivation',
    gcode: prepared.gcode,
    prepared: prepared.prepared,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    ...(prepared.jobOrigin === undefined ? {} : { jobOrigin: prepared.jobOrigin }),
    canvasPlan: prepared.canvasPlan,
    controllerSettings: laser.controllerSettings,
    createdAtIso: '2026-07-16T10:00:00.000Z',
  });
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
});

afterEach(() => {
  localStorage.clear();
  useLaserStore.setState(initialLaserState());
});

describe('deriveCncArtifactPassSpans', () => {
  it('re-derives one ascending in-range span per pass from the sealed artifact', async () => {
    const artifact = await archivedCncArtifact();
    const spans = deriveCncArtifactPassSpans(artifact);
    expect(spans).not.toBeNull();
    if (spans === null) return;
    const totalPasses = artifact.prepared.job.groups.reduce(
      (count, group) => count + (group.kind === 'cnc' ? group.passes.length : 0),
      0,
    );
    expect(spans.length).toBe(totalPasses);
    expect(spans.length).toBeGreaterThan(0);
    let previousLast = 0;
    for (const span of spans) {
      expect(span.firstRawLine).toBeGreaterThan(previousLast);
      expect(span.lastRawLine).toBeLessThan(artifact.gcode.split('\n').length);
      previousLast = span.lastRawLine;
    }
  });

  it('returns null when the sealed bytes are not reproduced', async () => {
    const artifact = await archivedCncArtifact();
    const tampered = createExecutionArtifact({
      runId: 'run-tampered',
      gcode: `${artifact.gcode}G0 X0.000 Y0.000\n`,
      prepared: artifact.prepared,
      outputScope: artifact.outputScope,
      ...(artifact.jobOrigin === undefined ? {} : { jobOrigin: artifact.jobOrigin }),
      canvasPlan: artifact.canvasPlan,
      controllerSettings: artifact.archivedControllerObservation.settings,
      createdAtIso: artifact.createdAtIso,
    });
    expect(deriveCncArtifactPassSpans(tampered)).toBeNull();
  });

  it('returns null for non-CNC artifacts', async () => {
    const artifact = await archivedCncArtifact();
    // Type-level: machineKind is a plain union field; the guard must refuse
    // without consulting the prepared payload.
    expect(deriveCncArtifactPassSpans({ ...artifact, machineKind: 'laser' })).toBeNull();
  });
});
