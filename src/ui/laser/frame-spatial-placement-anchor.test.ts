import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import type { OutputScope } from '../../core/scene';
import { frameSpatialPlacementBinding } from './frame-spatial-placement-anchor';
import * as output from '../../io/gcode/prepare-output';
import { currentFrameSpatialSignature } from './frame-spatial-identity';
import { installFrameOnceProject } from './frame-once.test-support';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';

const scope: OutputScope = {
  cutSelectedGraphics: true,
  useSelectionOrigin: false,
  selectedObjectIds: ['selected'],
};
const placement = { startFrom: 'user-origin', anchor: 'back-right' } as const;
afterEach(() => {
  vi.restoreAllMocks();
  useLaserStore.setState(initialLaserState());
});

function emptyCncProject(): Project {
  const base = createProject();
  return { ...base, machine: DEFAULT_CNC_MACHINE_CONFIG, scene: { ...base.scene } };
}

describe('whole-scene placement bounds memo', () => {
  it('reuses numeric bounds across real selections and renders around unchanged scene inputs', () => {
    installFrameOnceProject();
    const original = useStore.getState().project;
    const selected = original.scene.objects[0];
    if (selected === undefined) throw new Error('Missing artwork fixture');
    useStore.setState({
      project: {
        ...original,
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        scene: { ...original.scene, objects: [selected, { ...selected, id: 'other' }] },
      },
      outputScopeSettings: { cutSelectedGraphics: false, useSelectionOrigin: false },
    });
    useStore.getState().setOutputScopeSettings({ cutSelectedGraphics: true });
    useStore.getState().setJobPlacement(placement);
    useStore.getState().selectObject(selected.id);
    const app = useStore.getState();
    currentFrameSpatialSignature(app);
    const compute = vi.spyOn(output, 'selectedOutputPlacementBounds');
    for (let index = 0; index < 12; index += 1) {
      useStore.getState().selectObject(index % 2 === 0 ? 'other' : selected.id);
      expect(useStore.getState().project).not.toBe(app.project);
      expect(useStore.getState().project.scene).toBe(app.project.scene);
      currentFrameSpatialSignature();
      currentFrameSpatialSignature();
    }
    expect(compute).not.toHaveBeenCalled();
  });

  it('refreshes for scene, layer, tool, device and active-side inputs and keeps one result per source scene', () => {
    const compute = vi.spyOn(output, 'selectedOutputPlacementBounds');
    let project = emptyCncProject();
    const bind = () => frameSpatialPlacementBinding(project, scope, placement);
    expect(bind()).toEqual({ kind: 'known', anchor: { x: 0, y: 0 } });
    expect(compute).toHaveBeenCalledTimes(1);
    project = { ...project, notes: 'Selection wrapper' };
    bind();
    expect(compute).toHaveBeenCalledTimes(1);
    project = { ...project, scene: { ...project.scene, objects: [...project.scene.objects] } };
    bind();
    expect(compute).toHaveBeenCalledTimes(2);
    project = { ...project, scene: { ...project.scene, layers: [...project.scene.layers] } };
    bind();
    expect(compute).toHaveBeenCalledTimes(3);
    project = {
      ...project,
      machine: { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools] },
    };
    bind();
    expect(compute).toHaveBeenCalledTimes(4);
    const priorDevice = project.device;
    project = { ...project, device: { ...priorDevice, origin: 'rear-right' } };
    bind();
    expect(compute).toHaveBeenCalledTimes(5);
    project = { ...project, device: priorDevice };
    bind();
    expect(compute).toHaveBeenCalledTimes(6);
    project = {
      ...project,
      cncSetup: {
        ...defaultCncMachiningSetup(),
        twoSided: {
          activeSide: 'A',
          flipAxis: 'x',
          sideBStockOriginMm: { x: 0, y: 0 },
          sideAObjectIds: [],
          sideBObjectIds: [],
          registration: [],
        },
      },
    };
    bind();
    expect(compute).toHaveBeenCalledTimes(7);
    const setup = project.cncSetup;
    if (setup?.twoSided === undefined) throw new Error('Missing side fixture');
    project = { ...project, cncSetup: { ...setup, notes: 'Metadata only' } };
    bind();
    expect(compute).toHaveBeenCalledTimes(7);
    project = {
      ...project,
      cncSetup: { ...setup, twoSided: { ...setup.twoSided, activeSide: 'B' } },
    };
    bind();
    expect(compute).toHaveBeenCalledTimes(8);
  });

  it('caches unresolved bounds without masking subsequent corrected source', () => {
    const project = emptyCncProject();
    const compute = vi.spyOn(output, 'selectedOutputPlacementBounds').mockImplementationOnce(() => {
      throw new Error('No representable bounds');
    });
    expect(frameSpatialPlacementBinding(project, scope, placement)).toEqual({ kind: 'unresolved' });
    expect(frameSpatialPlacementBinding({ ...project }, scope, placement)).toEqual({
      kind: 'unresolved',
    });
    expect(compute).toHaveBeenCalledTimes(1);
    expect(
      frameSpatialPlacementBinding({ ...project, scene: { ...project.scene } }, scope, placement),
    ).toEqual({ kind: 'known', anchor: { x: 0, y: 0 } });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('does not compile whole-scene bounds for absolute or selection-origin placement', () => {
    const project = emptyCncProject();
    const compute = vi.spyOn(output, 'selectedOutputPlacementBounds');
    expect(
      frameSpatialPlacementBinding(project, scope, { ...placement, startFrom: 'absolute' }),
    ).toBeUndefined();
    expect(
      frameSpatialPlacementBinding(project, { ...scope, useSelectionOrigin: true }, placement),
    ).toBeUndefined();
    expect(
      frameSpatialPlacementBinding(project, { ...scope, cutSelectedGraphics: false }, placement),
    ).toBeUndefined();
    expect(compute).not.toHaveBeenCalled();
  });
});
