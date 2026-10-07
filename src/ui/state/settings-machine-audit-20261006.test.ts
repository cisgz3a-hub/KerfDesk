import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_LAYER_SETTINGS,
  LASER_MACHINE_CONFIG,
  layerCncTool,
  type CncMachineConfig,
  type CncLayerSettings,
  type Project,
} from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { compileCncJob } from '../../core/cnc/compile-cnc-job';
import { cncGrblStrategy } from '../../core/output/cnc-grbl-strategy';
import { cncPassXyPoints } from '../../core/job';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

const workshopMachine: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, safeZMm: 10 },
};
const fileTool = {
  id: 'file-only-six',
  name: 'File 6 mm',
  kind: 'end-mill' as const,
  diameterMm: 6,
};
const fileMachine: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, safeZMm: 19 },
  stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 29, materialKey: 'plywood-mdf' },
  tools: [fileTool],
  toolId: fileTool.id,
  tiling: { tileWidthMm: 123, tileHeightMm: 234, overlapMm: 10, registrationHoles: false },
};
beforeEach(() => {
  localStorage.clear();
  resetStore();
  useStore.setState({ cachedCncMachine: null });
});
afterEach(() => {
  localStorage.clear();
  resetStore();
  useStore.setState({ cachedCncMachine: null });
});

function codecOpen(project: Project): void {
  const result = deserializeProject(serializeProject(project));
  if (result.kind !== 'ok') throw new Error('Audit fixture must be a codec-accepted project');
  useStore.getState().setProject(result.project);
}

function firstCncLayerSettings(): CncLayerSettings {
  const layer = useStore.getState().project.scene.layers[0];
  if (!layer?.cnc) throw new Error('CNC layer fixture missing');
  return layer.cnc;
}

function openedCncJob(): Project {
  const artwork = svgObj('saved-artwork', ['#ff0000']);
  useStore.getState().importSvgObject({
    ...artwork,
    bounds: { minX: 20, minY: 20, maxX: 40, maxY: 40 },
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 20, y: 20 },
              { x: 40, y: 20 },
              { x: 40, y: 40 },
              { x: 20, y: 40 },
            ],
          },
        ],
      },
    ],
  });
  const seeded = useStore.getState().project;
  return {
    ...seeded,
    device: { ...DEFAULT_DEVICE_PROFILE, name: 'File machine', cncSubProfile: fileMachine.params },
    machine: fileMachine,
    scene: {
      ...seeded.scene,
      layers: seeded.scene.layers.map((layer) => ({
        ...layer,
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-outside', toolId: fileTool.id },
      })),
    },
  };
}

describe('settings ownership audit: choosing current hardware after Open', () => {
  it('keeps the saved job cutter, stock and tiling when selecting the current CNC hardware', () => {
    const opened = openedCncJob();
    useStore.getState().setProject({
      ...createProject({
        ...DEFAULT_DEVICE_PROFILE,
        name: 'Workshop',
        cncSubProfile: workshopMachine.params,
      }),
      machine: workshopMachine,
    });
    codecOpen(opened);
    const before = useStore.getState().project.machine;
    if (before?.kind !== 'cnc') throw new Error('CNC fixture missing');
    expect(layerCncTool(before, firstCncLayerSettings()).diameterMm).toBe(6);
    const beforeJob = compileCncJob(
      useStore.getState().project.scene,
      useStore.getState().project.device,
      before,
    );
    expect(beforeJob.groups[0]).toMatchObject({
      kind: 'cnc',
      toolId: fileTool.id,
      toolDiameterMm: 6,
    });

    useStore.getState().keepCurrentMachineForOpenedProject();
    const after = useStore.getState().project.machine;
    if (after?.kind !== 'cnc') throw new Error('CNC fixture missing');
    expect(after.params.safeZMm).toBe(10);
    expect.soft(layerCncTool(after, firstCncLayerSettings()).diameterMm).toBe(6);
    expect.soft(after.stock).toEqual(fileMachine.stock);
    expect.soft(after.tiling).toEqual(fileMachine.tiling);
    const afterJob = compileCncJob(
      useStore.getState().project.scene,
      useStore.getState().project.device,
      after,
    );
    expect
      .soft(afterJob.groups[0])
      .toMatchObject({ kind: 'cnc', toolId: fileTool.id, toolDiameterMm: 6 });
    expect(
      afterJob.groups.flatMap((group) =>
        group.kind === 'cnc' ? group.passes.map(cncPassXyPoints) : [],
      ),
    ).toEqual(
      beforeJob.groups.flatMap((group) =>
        group.kind === 'cnc' ? group.passes.map(cncPassXyPoints) : [],
      ),
    );
    const expectedJob = compileCncJob(opened.scene, useStore.getState().project.device, {
      ...fileMachine,
      params: after.params,
    });
    expect(cncGrblStrategy.emit(afterJob, useStore.getState().project.device)).toBe(
      cncGrblStrategy.emit(expectedJob, useStore.getState().project.device),
    );
  });

  it('keeps current parked CNC hardware when returning to Laser, then to CNC, after Open', () => {
    const opened = openedCncJob();
    useStore.getState().setProject({
      ...createProject({
        ...DEFAULT_DEVICE_PROFILE,
        name: 'Workshop',
        cncSubProfile: workshopMachine.params,
      }),
      machine: LASER_MACHINE_CONFIG,
      parkedCncMachine: workshopMachine,
    });
    codecOpen(opened);
    useStore.getState().keepCurrentMachineForOpenedProject();
    expect(useStore.getState().project.machine?.kind).toBe('laser');
    expect(useStore.getState().project.device.cncSubProfile?.safeZMm).toBe(10);
    useStore.getState().setMachineKind('cnc');
    const after = useStore.getState().project.machine;
    if (after?.kind !== 'cnc') throw new Error('CNC fixture missing');
    expect.soft(after.params.safeZMm).toBe(10);
    expect.soft(after.stock).toEqual(fileMachine.stock);
    expect.soft(layerCncTool(after, firstCncLayerSettings()).diameterMm).toBe(6);
  });
});
