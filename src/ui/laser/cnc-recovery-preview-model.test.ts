import { describe, expect, it } from 'vitest';
import { createJobCheckpoint, advanceJobCheckpoint } from '../../core/recovery';
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
import { buildCncRecoveryPreviewModel } from './cnc-recovery-preview-model';

const NOW = '2026-07-14T12:00:00.000Z';

function cncProject(): Project {
  const color = '#ff0000';
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
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

function matchingCheckpoint(project: Project) {
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

describe('buildCncRecoveryPreviewModel', () => {
  it('shows hypothetical geometry while keeping execution impossible', () => {
    const project = cncProject();
    const model = buildCncRecoveryPreviewModel(project, matchingCheckpoint(project));
    expect(model.canExecute).toBe(false);
    expect(model.unavailableReason).toBeNull();
    expect(model.events.length).toBeGreaterThan(0);
    expect(model.geometry).toMatchObject({ kind: 'preview', executable: false });
    expect(model.checks).toContainEqual(
      expect.objectContaining({ id: 'program-identity', status: 'matched' }),
    );
    expect(model.checks).toContainEqual(
      expect.objectContaining({ id: 'execution-fence', status: 'missing' }),
    );
  });

  it('refuses geometry when the current project does not match the checkpoint', () => {
    const project = cncProject();
    const checkpoint = createJobCheckpoint({
      gcode: 'G21\nG90\nM30',
      machineKind: 'cnc',
      outputScope: DEFAULT_OUTPUT_SCOPE,
      nowIso: NOW,
    });
    const model = buildCncRecoveryPreviewModel(project, checkpoint);
    expect(model.canExecute).toBe(false);
    expect(model.geometry).toBeNull();
    expect(model.unavailableReason).toContain('does not reproduce');
    expect(model.checks).toContainEqual(
      expect.objectContaining({ id: 'program-identity', status: 'mismatch' }),
    );
  });

  it('refuses a laser project even when the checkpoint says CNC', () => {
    const project = createProject();
    const checkpoint = createJobCheckpoint({
      gcode: 'G21\nG90\nM30',
      machineKind: 'cnc',
      outputScope: DEFAULT_OUTPUT_SCOPE,
      nowIso: NOW,
    });
    expect(buildCncRecoveryPreviewModel(project, checkpoint)).toMatchObject({
      canExecute: false,
      geometry: null,
      unavailableReason: expect.stringContaining('original CNC project'),
    });
  });
});
