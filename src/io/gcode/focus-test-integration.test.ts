import { describe, expect, it, vi } from 'vitest';
import { generateFocusTest } from '../../core/job/focus-test';
import {
  createLayerSubLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  type Project,
} from '../../core/scene';
import { COMPILE_INTEGRITY_PREFLIGHT_CODES } from '../../core/preflight';
import { prepareOutput } from './prepare-output';
import { prepareOutputAsync } from './prepare-output-async';
import { emitGcode, emitPreparedGcode } from './emit-gcode';
import { prepareOutputForStructuredClone } from './prepared-output-persistence';
import { packProjectMessage, unpackProjectMessage } from '../../ui/packed-project-transfer';

function focusProject(): Project {
  return {
    ...createProject(),
    scene: generateFocusTest({
      steps: 3,
      minOffsetMm: -1,
      maxOffsetMm: 1,
      lineLengthMm: 20,
      spacingMm: 3,
      speed: 1200,
      power: 10,
      travelFeedMmPerMin: 300,
    }),
  };
}

describe('Focus Test output integration', () => {
  it('refuses CNC reinterpretation when preparing synchronous or worker output', async () => {
    const project = { ...focusProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
    const prepared = prepareOutput(project);
    expect(prepared).toMatchObject({
      ok: false,
      preflight: { issues: [{ code: 'focus-test-needs-laser' }] },
    });
    expect(COMPILE_INTEGRITY_PREFLIGHT_CODES.has('focus-test-needs-laser')).toBe(true);
    const runCncTasks = vi.fn();
    expect(await prepareOutputAsync(project, {}, { jobId: 'focus-cnc', runCncTasks })).toEqual(
      prepared,
    );
    expect(runCncTasks).not.toHaveBeenCalled();
    expect(emitGcode(project).gcode).toBe('');
  });

  it('does not refuse unrelated selected CNC artwork or disabled focus operations', () => {
    const source = focusProject();
    const last = source.scene.layers.at(-1);
    if (last === undefined) throw new Error('Missing sample');
    const { focusTest: _focus, ...ordinary } = last;
    const project: Project = {
      ...source,
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: { ...source.scene, layers: [...source.scene.layers.slice(0, -1), ordinary] },
    };
    const prepared = prepareOutput(project, {
      outputScope: {
        cutSelectedGraphics: true,
        useSelectionOrigin: false,
        selectedObjectIds: ['focus-test-3-line'],
      },
    });
    expect(prepared.ok).toBe(true);
    const disabled = {
      ...project,
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((layer) =>
          layer.focusTest === undefined ? layer : { ...layer, output: false },
        ),
      },
    };
    expect(prepareOutput(disabled).ok).toBe(true);
  });

  it('retains focus metadata through packed worker transfer, preparation and persistence', () => {
    const source = focusProject();
    const project = {
      ...source,
      scene: {
        ...source.scene,
        objects: source.scene.objects.map((object) =>
          object.kind !== 'imported-svg'
            ? object
            : {
                ...object,
                paths: object.paths.map((path) => ({
                  ...path,
                  polylines: [
                    {
                      closed: false,
                      points: Array.from({ length: 5001 }, (_, index) => ({
                        x: index / 250,
                        y: 0,
                      })),
                    },
                  ],
                })),
              },
        ),
      },
    };
    const packed = packProjectMessage(project);
    expect(packed.transfer.length).toBeGreaterThan(0);
    const received = unpackProjectMessage(structuredClone(packed.message));
    expect(received.scene.layers).toEqual(project.scene.layers);
    const prepared = prepareOutput(received);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error('Missing prepared focus job');
    expect(
      prepared.job.groups
        .filter((group) => group.kind === 'cut')
        .map((group) => group.focusTest?.offsetMm),
    ).toEqual([-1, 0, 1]);
    const restored = structuredClone(prepareOutputForStructuredClone(prepared));
    const gcode = emitPreparedGcode(restored).gcode;
    expect(gcode).toBe(emitPreparedGcode(prepared).gcode);
    expect((gcode.match(/; Focus Test Z offset/g) ?? []).length).toBe(3);
    expect(gcode).toContain('G1 Z-1.000 F300 S0');
  });

  it('retains focus Z on enabled subpasses', () => {
    const source = focusProject();
    const project = {
      ...source,
      scene: {
        ...source.scene,
        layers: source.scene.layers.map((layer) => ({
          ...layer,
          subLayers: [createLayerSubLayer(layer, { id: 'second', label: 'Second pass' })],
        })),
      },
    };
    const prepared = prepareOutput(project);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error('Missing focus subpasses');
    expect(
      prepared.job.groups
        .filter((group) => group.kind === 'cut')
        .map((group) => group.focusTest?.offsetMm),
    ).toEqual([-1, -1, 0, 0, 1, 1]);
  });
});
