import { describe, expect, it } from 'vitest';
import type { CncGroup, Job } from '../../core/job';
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
import { buildCanvasMotionPlan } from '../state/canvas-motion-plan';
import { createExecutionArtifact, type RecoveryCapsule } from '../state/recovery';
import { buildCncRecoveryPreviewModel } from './cnc-recovery-preview-model';

const NOW = '2026-07-14T12:00:00.000Z';

describe('buildCncRecoveryPreviewModel represented events', () => {
  it('offers only represented runway events from a parser-collapsed contour', () => {
    const capsule = precisionCapsule();

    const unselected = buildCncRecoveryPreviewModel(capsule);
    expect(unselected.events.map(({ id }) => id)).toEqual(['cnc-op-1/pass-1/cut-3']);
    expect(buildCncRecoveryPreviewModel(capsule, 'cnc-op-1/pass-1/cut-2')).toMatchObject({
      canExecute: false,
      selectedEventId: null,
      geometry: null,
    });
    const selected = buildCncRecoveryPreviewModel(capsule, 'cnc-op-1/pass-1/cut-3');
    expect(selected.canExecute).toBe(true);
    expect(selected.geometry).toMatchObject({
      kind: 'preview',
      eventId: 'cnc-op-1/pass-1/cut-3',
    });
    if (selected.geometry?.kind !== 'preview') throw new Error('Expected represented preview.');
    expect(selected.geometry.recoveryPolyline).not.toContainEqual({ x: 10_010.0004, y: 20_000 });
  });
});

type ExactCapsule = RecoveryCapsule & {
  readonly artifact: Extract<RecoveryCapsule['artifact'], { readonly kind: 'exact-execution' }>;
};

function precisionCapsule(): ExactCapsule {
  const prepared = prepareOutput(precisionProject());
  if (!prepared.ok) throw new Error('Expected base prepared CNC output.');
  const exactPrepared = { ...prepared, job: precisionJob() };
  const emitted = emitPreparedGcode(exactPrepared);
  const runId = 'run-archived-cnc-precision';
  const artifact = createExecutionArtifact({
    artifactSchemaVersion: 1,
    runId,
    gcode: emitted.gcode,
    prepared: exactPrepared,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: buildCanvasMotionPlan({
      gcode: emitted.gcode,
      prepared: exactPrepared,
      machine: { statusReport: null, alarmCode: null, hasActiveStreamer: false },
      retentionKey: 'archived-cnc-precision-signature',
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

function precisionProject(): Project {
  const color = '#ff0000';
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'straight-path',
    source: 'straight.svg',
    bounds: { minX: 20, minY: 20, maxX: 80, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: false,
            points: [
              { x: 20, y: 20 },
              { x: 40, y: 20 },
              { x: 60, y: 20 },
              { x: 80, y: 20 },
            ],
          },
        ],
      },
    ],
  };
  const base = createProject();
  return {
    ...base,
    device: { ...base.device, bedWidth: 30_000, bedHeight: 30_000 },
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, widthMm: 30_000, heightMm: 30_000 },
    },
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

function precisionJob(): Job {
  const group: CncGroup = {
    kind: 'cnc',
    layerId: 'layer-a',
    color: '#ff0000',
    cutType: 'profile-on-path',
    toolId: 'tool-1',
    toolDiameterMm: 3.175,
    feedMmPerMin: 600,
    plungeMmPerMin: 180,
    spindleRpm: 12_000,
    spindleSpinupSec: 3,
    safeZMm: 5,
    passes: [
      {
        kind: 'contour',
        zMm: -2,
        closed: false,
        polyline: [
          { x: 10_000, y: 20_000 },
          { x: 10_010, y: 20_000 },
          { x: 10_010.0004, y: 20_000 },
          { x: 10_020, y: 20_000 },
        ],
      },
    ],
  };
  return { groups: [group] };
}
