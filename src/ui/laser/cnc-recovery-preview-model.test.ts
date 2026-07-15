import { afterEach, describe, expect, it } from 'vitest';
import { advanceJobCheckpoint, createJobCheckpoint, type JobCheckpoint } from '../../core/recovery';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { useStore } from '../state';
import { buildCanvasMotionPlan } from '../state/canvas-motion-plan';
import { createExecutionArtifact, type RecoveryCapsule } from '../state/recovery';
import {
  buildCncRecoveryPreviewModel,
  buildLegacyFingerprintOnlyCncRecoveryPreviewModel,
} from './cnc-recovery-preview-model';

const NOW = '2026-07-14T12:00:00.000Z';
const SELECTED_EVENT = 'cnc-op-1/pass-1/cut-2';

afterEach(() => {
  useStore.setState({ project: createProject() });
});

describe('buildCncRecoveryPreviewModel', () => {
  it('uses the archived prepared job and manifest for exact capsule geometry', () => {
    const capsule = exactCapsule(cncProject());
    const unselected = buildCncRecoveryPreviewModel(capsule);
    expect(unselected.canExecute).toBe(false);
    expect(unselected.geometry).toBeNull();
    expect(unselected.events.length).toBeGreaterThan(0);

    const model = buildCncRecoveryPreviewModel(capsule, SELECTED_EVENT);
    expect(model.canExecute).toBe(true);
    expect(model.unavailableReason).toBeNull();
    expect(model.geometry).toMatchObject({ kind: 'preview', executable: false });
    expect(model.parameters).toEqual({
      minRunwayMm: 5,
      accelerationMmPerSec2: 100,
      safetyMarginMm: 2,
    });
    expect(model.checks).toContainEqual(
      expect.objectContaining({ id: 'program-identity', status: 'matched' }),
    );
    expect(model.checks).toContainEqual(
      expect.objectContaining({ id: 'semantic-line-map', status: 'matched' }),
    );
    expect(model.checks).toContainEqual(
      expect.objectContaining({ id: 'machine-state', status: 'diagnostic' }),
    );
    expect(model.checks).toContainEqual(
      expect.objectContaining({ id: 'execution-fence', status: 'missing' }),
    );
  });

  it('ignores an unrelated changed current project for an exact capsule preview', () => {
    const capsule = exactCapsule(cncProject(20));
    useStore.setState({ project: cncProject(30) });

    const model = buildCncRecoveryPreviewModel(capsule, SELECTED_EVENT);
    expect(model.canExecute).toBe(true);
    if (model.geometry?.kind !== 'preview') throw new Error('Expected archived runway preview.');
    expect(model.geometry.uncertaintySegment).toEqual([
      { x: 40, y: 380 },
      { x: 60, y: 380 },
    ]);
    expect(model.checks).toContainEqual(
      expect.objectContaining({
        id: 'program-identity',
        detail: expect.stringContaining('exact emitted G-code'),
      }),
    );
  });

  it('keeps current-project compilation behind the named legacy-only fallback', () => {
    const original = cncProject(20);
    const checkpoint = matchingCheckpoint(original);
    const capsule = legacyCapsule(checkpoint);

    const sealedApi = buildCncRecoveryPreviewModel(capsule, SELECTED_EVENT);
    expect(sealedApi).toMatchObject({
      canExecute: false,
      unavailableReason: expect.stringContaining('explicit legacy current-project fallback'),
    });

    const matching = buildLegacyFingerprintOnlyCncRecoveryPreviewModel(
      original,
      capsule,
      SELECTED_EVENT,
    );
    expect(matching.canExecute).toBe(true);
    expect(matching.checks).toContainEqual(
      expect.objectContaining({ id: 'program-identity', status: 'matched' }),
    );

    const changed = buildLegacyFingerprintOnlyCncRecoveryPreviewModel(
      cncProject(30),
      capsule,
      SELECTED_EVENT,
    );
    expect(changed).toMatchObject({
      canExecute: false,
      geometry: null,
      unavailableReason: expect.stringContaining('does not reproduce'),
    });
    expect(changed.checks).toContainEqual(
      expect.objectContaining({ id: 'program-identity', status: 'mismatch' }),
    );
  });

  it('refuses an exact capsule whose archived semantic manifest is missing', () => {
    const capsule = exactCapsule(cncProject());
    const { cncRecoveryManifest, ...artifactWithoutManifest } = capsule.artifact;
    if (cncRecoveryManifest === undefined) throw new Error('Expected archived CNC manifest.');
    const broken: ExactCapsule = {
      ...capsule,
      artifact: artifactWithoutManifest,
    };
    const model = buildCncRecoveryPreviewModel(broken, SELECTED_EVENT);
    expect(model).toMatchObject({
      canExecute: false,
      geometry: null,
      unavailableReason: expect.stringContaining('semantic recovery manifest'),
    });
    expect(model.checks).toContainEqual(
      expect.objectContaining({ id: 'semantic-line-map', status: 'missing' }),
    );
  });

  it('refuses altered prepared semantics even when their replacement manifest matches', () => {
    const capsule = exactCapsule(cncProject(20));
    const altered = exactCapsule(cncProject(30)).artifact;
    const broken: ExactCapsule = {
      ...capsule,
      artifact: {
        ...capsule.artifact,
        prepared: altered.prepared,
        cncRecoveryManifest: altered.cncRecoveryManifest,
      },
    };

    const model = buildCncRecoveryPreviewModel(broken, SELECTED_EVENT);

    expect(model).toMatchObject({
      canExecute: false,
      geometry: null,
      unavailableReason: expect.stringContaining('sealed exact G-code'),
    });
    expect(model.checks).toContainEqual(
      expect.objectContaining({ id: 'semantic-line-map', status: 'mismatch' }),
    );
  });

  it('uses archived device acceleration and fails closed when it is invalid', () => {
    const project = cncProject();
    const capsule = exactCapsule({
      ...project,
      device: { ...project.device, accelMmPerSec2: 0 },
    });
    expect(buildCncRecoveryPreviewModel(capsule)).toMatchObject({
      canExecute: false,
      geometry: null,
      unavailableReason: expect.stringContaining('archived device acceleration'),
    });
  });

  it('retains the deprecated checkpoint overload only as migration compatibility', () => {
    const project = cncProject();
    const model = buildCncRecoveryPreviewModel(project, matchingCheckpoint(project));
    expect(model.events.length).toBeGreaterThan(0);
    expect(model.checks).toContainEqual(
      expect.objectContaining({ id: 'program-identity', status: 'matched' }),
    );
  });
});

type ExactCapsule = RecoveryCapsule & {
  readonly artifact: Extract<RecoveryCapsule['artifact'], { readonly kind: 'exact-execution' }>;
};

function cncProject(segmentLength = 20): Project {
  const color = '#ff0000';
  const finalX = 20 + segmentLength * 3;
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'straight-path',
    source: 'straight.svg',
    bounds: { minX: 20, minY: 20, maxX: finalX, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: false,
            points: [
              { x: 20, y: 20 },
              { x: 20 + segmentLength, y: 20 },
              { x: 20 + segmentLength * 2, y: 20 },
              { x: finalX, y: 20 },
            ],
          },
        ],
      },
    ],
  };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: [object],
      layers: [
        {
          ...createLayer({ id: 'layer-a', color }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-on-path' },
        },
      ],
    },
  };
}

function exactCapsule(project: Project): ExactCapsule {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('Expected prepared CNC output.');
  const emitted = emitPreparedGcode(prepared);
  if (!emitted.preflight.ok) throw new Error('Expected valid CNC preflight.');
  const runId = 'run-archived-cnc';
  const artifact = createExecutionArtifact({
    runId,
    gcode: emitted.gcode,
    prepared,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: buildCanvasMotionPlan({
      gcode: emitted.gcode,
      prepared,
      machine: { statusReport: null, alarmCode: null, hasActiveStreamer: false },
      retentionKey: 'archived-cnc-signature',
    }),
    controllerSettings: null,
    createdAtIso: NOW,
  });
  return {
    runId,
    artifactKind: artifact.kind,
    revision: 1,
    ackedLines: Math.min(3, artifact.sendableLines),
    sendableLines: artifact.sendableLines,
    interruption: { kind: 'disconnect', message: 'Connection lost.' },
    updatedAtIso: NOW,
    artifact,
  };
}

function matchingCheckpoint(project: Project): JobCheckpoint {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('Expected prepared CNC output.');
  const emitted = emitPreparedGcode(prepared);
  if (!emitted.preflight.ok) throw new Error('Expected valid CNC preflight.');
  return advanceJobCheckpoint(
    createJobCheckpoint({
      gcode: emitted.gcode,
      machineKind: 'cnc',
      outputScope: DEFAULT_OUTPUT_SCOPE,
      nowIso: NOW,
    }),
    3,
    NOW,
  );
}

function legacyCapsule(checkpoint: JobCheckpoint): RecoveryCapsule {
  const artifact = {
    schemaVersion: 1,
    kind: 'legacy-fingerprint-only',
    runId: 'legacy-cnc',
    createdAtIso: checkpoint.startedAtIso,
    migratedAtIso: NOW,
    fingerprint: checkpoint.fingerprint,
    sendableLines: checkpoint.sendableLines,
    machineKind: checkpoint.machineKind,
    outputScope: checkpoint.outputScope,
    ...(checkpoint.jobOrigin === undefined ? {} : { jobOrigin: checkpoint.jobOrigin }),
  } satisfies Extract<RecoveryCapsule['artifact'], { readonly kind: 'legacy-fingerprint-only' }>;
  return {
    runId: artifact.runId,
    artifactKind: artifact.kind,
    revision: 1,
    ackedLines: checkpoint.ackedLines,
    sendableLines: checkpoint.sendableLines,
    interruption: { kind: 'unknown', message: 'Migrated legacy record.' },
    updatedAtIso: NOW,
    artifact,
  };
}
