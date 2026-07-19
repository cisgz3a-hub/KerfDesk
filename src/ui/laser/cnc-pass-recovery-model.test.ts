import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { createExecutionArtifact, type RecoveryCapsule } from '../state/recovery';
import { buildCncPassRecoveryModel } from './cnc-pass-recovery-model';

function recoveryProject(): Project {
  const color = '#ff0000';
  // 40 points → ~39 cut lines per pass, so each pass span dwarfs the grbl
  // planner reserve and the all-acknowledged case can prove earlier passes.
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'straight-path',
    source: 'straight.svg',
    bounds: { minX: 20, minY: 20, maxX: 59, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: false,
            points: Array.from({ length: 40 }, (_, i) => ({ x: 20 + i, y: 20 })),
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
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'profile-on-path',
            depthMm: 3,
            depthPerPassMm: 1,
          },
        },
      ],
    },
  };
}

function exactCapsule(options?: {
  readonly ackedLines?: number;
  readonly archiveWco?: boolean;
  readonly interruptionKind?: RecoveryCapsule['interruption']['kind'];
}): RecoveryCapsule {
  const prepared = prepareOutput(recoveryProject());
  if (!prepared.ok) throw new Error('Expected prepared CNC output.');
  const emitted = emitPreparedGcode(prepared);
  if (!emitted.preflight.ok) throw new Error('Expected valid CNC preflight.');
  const runId = 'run-archived-cnc';
  const artifact = createExecutionArtifact({
    artifactSchemaVersion: 1,
    runId,
    gcode: emitted.gcode,
    prepared,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: { retentionKey: 'archived-cnc-signature' } as CanvasMotionPlan,
    controllerSettings: null,
    ...(options?.archiveWco === false
      ? {}
      : { controllerObservation: { wco: { x: 0, y: 0, z: 0 } } }),
    createdAtIso: '2026-07-16T12:00:00.000Z',
  });
  return {
    runId,
    artifactKind: artifact.kind,
    revision: 1,
    ackedLines: options?.ackedLines ?? Math.min(3, artifact.sendableLines),
    sendableLines: artifact.sendableLines,
    interruption: {
      kind: options?.interruptionKind ?? 'disconnect',
      message: 'Connection lost.',
    },
    updatedAtIso: '2026-07-16T12:01:00.000Z',
    artifact,
  };
}

describe('buildCncPassRecoveryModel', () => {
  it('lists every pass with labels and preselects the computed boundary', () => {
    const model = buildCncPassRecoveryModel(exactCapsule(), { x: 0, y: 0, z: 0 });
    expect(model.kind).toBe('ready');
    if (model.kind !== 'ready') return;
    expect(model.passes).toHaveLength(3);
    expect(model.passes[0]?.label).toContain('pass 1 of 3');
    expect(model.passes[0]?.label).toContain('Z -1.000 mm');
    expect(model.passes[0]?.xyPoints.length).toBeGreaterThan(1);
    expect(model.defaultSelection).toEqual({ groupIndex: 0, passIndex: 0 });
    expect(model.retainedPositionIssue).toBeNull();
  });

  it('marks early-ack progress as uncertain from the first pass onward', () => {
    const model = buildCncPassRecoveryModel(exactCapsule(), { x: 0, y: 0, z: 0 });
    if (model.kind !== 'ready') throw new Error(model.kind);
    expect(model.passes.map(({ status }) => status)).toEqual(['uncertain', 'pending', 'pending']);
  });

  it('proves earlier passes complete when every line was acknowledged', () => {
    const capsule = exactCapsule();
    const model = buildCncPassRecoveryModel(
      { ...capsule, ackedLines: capsule.sendableLines },
      { x: 0, y: 0, z: 0 },
    );
    if (model.kind !== 'ready') throw new Error(model.kind);
    expect(model.defaultSelection).toEqual({ groupIndex: 0, passIndex: 2 });
    expect(model.passes.map(({ status }) => status)).toEqual([
      'proven-complete',
      'proven-complete',
      'uncertain',
    ]);
  });

  it('reports why retained position is unavailable', () => {
    const withoutBaseline = buildCncPassRecoveryModel(exactCapsule({ archiveWco: false }), {
      x: 0,
      y: 0,
      z: 0,
    });
    if (withoutBaseline.kind !== 'ready') throw new Error(withoutBaseline.kind);
    expect(withoutBaseline.retainedPositionIssue).toContain('no archived work-offset');

    const afterReboot = buildCncPassRecoveryModel(
      exactCapsule({ interruptionKind: 'controller-reboot' }),
      { x: 0, y: 0, z: 0 },
    );
    if (afterReboot.kind !== 'ready') throw new Error(afterReboot.kind);
    expect(afterReboot.retainedPositionIssue).toContain('rebooted');
  });

  it('is unavailable for non-CNC capsules', () => {
    const capsule = exactCapsule();
    const model = buildCncPassRecoveryModel(
      { ...capsule, artifact: { ...capsule.artifact, machineKind: 'laser' } },
      null,
    );
    expect(model).toEqual({
      kind: 'unavailable',
      reason: 'The retained checkpoint is not a CNC job.',
    });
  });
});
