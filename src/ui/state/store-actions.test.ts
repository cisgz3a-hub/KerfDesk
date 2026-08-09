// Undo/redo selection preservation (CNV-13). Undo/redo used to wipe the
// selection unconditionally, so undoing a nudge deselected everything and
// forced reselection on every tweak cycle. Now the prior selection survives
// as long as its ids still resolve to a live object in the restored scene.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  LASER_MACHINE_CONFIG,
  createLayer,
} from '../../core/scene';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { emitGcode } from '../../io/gcode';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

const MOVED_TRANSFORM = { ...IDENTITY_TRANSFORM, x: 50, y: 50 };

describe('useStore — undo/redo selection preservation (CNV-13)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('keeps a still-present object selected across undo', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    useStore.getState().applyObjectTransform('O1', MOVED_TRANSFORM); // pushes undo, keeps selection

    useStore.getState().undo();

    expect(useStore.getState().selectedObjectId).toBe('O1');
  });

  it('keeps a still-present object selected across redo', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    useStore.getState().applyObjectTransform('O1', MOVED_TRANSFORM);
    useStore.getState().undo();

    useStore.getState().redo();

    expect(useStore.getState().selectedObjectId).toBe('O1');
  });

  it('clears path-node selection on undo (indices reference the old geometry)', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    useStore.getState().applyObjectTransform('O1', MOVED_TRANSFORM);

    useStore.getState().undo();

    expect(useStore.getState().selectedPathNode).toBeNull();
    expect(useStore.getState().selectedPathNodes).toEqual([]);
  });

  it('commits profile, workspace, and CNC config as one undoable machine setup', () => {
    const profile = {
      ...DEFAULT_DEVICE_PROFILE,
      name: 'Atomic CNC',
      bedWidth: 610,
      bedHeight: 410,
    };
    const machine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, safeZMm: 9, spindleMaxRpm: 18000 },
    };

    useStore.getState().replaceMachineSetup(profile, machine);

    const state = useStore.getState();
    expect(state.project.device.name).toBe('Atomic CNC');
    expect(state.project.workspace).toMatchObject({ width: 610, height: 410 });
    expect(state.project.machine).toEqual(machine);
    expect(state.cachedCncMachine).toEqual(machine);
    expect(state.undoStack).toHaveLength(1);
    state.undo();
    expect(useStore.getState().project.device.name).toBe(DEFAULT_DEVICE_PROFILE.name);
    expect(useStore.getState().project.machine).toBeUndefined();
  });

  it('merges saved custom bits when Machine Setup switches a project to CNC', () => {
    useStore
      .getState()
      .addCustomCncTool({ name: 'Shop V-bit', kind: 'v-bit', diameterMm: 6, tipAngleDeg: 90 });

    useStore.getState().replaceMachineSetup(DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);

    const machine = useStore.getState().project.machine;
    expect(machine?.kind).toBe('cnc');
    if (machine?.kind === 'cnc') {
      expect(machine.tools.some((tool) => tool.name === 'Shop V-bit')).toBe(true);
    }
  });

  it('retains the edited CNC draft when Machine Setup saves Laser mode', () => {
    const retained = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, safeZMm: 12 },
    };

    useStore.getState().replaceMachineSetup(DEFAULT_DEVICE_PROFILE, LASER_MACHINE_CONFIG, retained);

    expect(useStore.getState().project.machine).toEqual(LASER_MACHINE_CONFIG);
    expect(useStore.getState().cachedCncMachine?.params.safeZMm).toBe(12);
  });

  it('commits Startup material and operation bindings as one undoable action', () => {
    const layer = {
      ...createLayer({ id: 'cnc-operation', color: '#aa0000' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS },
    };
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        scene: { ...project.scene, layers: [layer] },
      },
      cachedCncMachine: DEFAULT_CNC_MACHINE_CONFIG,
      undoStack: [],
      redoStack: [],
      dirty: false,
    });
    const machine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, materialKey: 'hardwood' },
    };

    useStore.getState().replaceCncStartupSetup(DEFAULT_DEVICE_PROFILE, machine, machine, {
      operationDrafts: [
        {
          layerId: layer.id,
          materialKey: 'hardwood',
          toolId: 'em-6350',
          vClearToolId: null,
          pocketRoughToolId: null,
          reliefFinishToolId: null,
        },
      ],
      customTools: [],
      materialApplyRequested: true,
    });

    const saved = useStore.getState();
    expect(
      saved.project.machine?.kind === 'cnc' ? saved.project.machine.stock.materialKey : null,
    ).toBe('hardwood');
    expect(saved.project.scene.layers[0]?.cnc).toMatchObject({
      materialKey: 'hardwood',
      toolId: 'em-6350',
      feedSource: { kind: 'material-recipe', materialKey: 'hardwood' },
    });
    expect(saved.undoStack).toHaveLength(1);

    saved.undo();
    expect(useStore.getState().project.scene.layers[0]?.cnc?.materialKey).toBeUndefined();
  });

  it('keeps emitted CNC G-code byte-identical when Startup values are unchanged', () => {
    const layer = {
      ...createLayer({ id: 'cnc-operation', color: '#aa0000' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS },
    };
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        scene: {
          objects: [svgObj('cnc-artwork', [layer.color])],
          layers: [layer],
        },
      },
      cachedCncMachine: DEFAULT_CNC_MACHINE_CONFIG,
      undoStack: [],
      redoStack: [],
      dirty: false,
    });
    const before = emitGcode(useStore.getState().project);

    useStore
      .getState()
      .replaceCncStartupSetup(
        DEFAULT_DEVICE_PROFILE,
        DEFAULT_CNC_MACHINE_CONFIG,
        DEFAULT_CNC_MACHINE_CONFIG,
        {
          operationDrafts: [
            {
              layerId: layer.id,
              materialKey: null,
              toolId: null,
              vClearToolId: null,
              pocketRoughToolId: null,
              reliefFinishToolId: null,
            },
          ],
          customTools: [],
          materialApplyRequested: false,
        },
      );

    const after = emitGcode(useStore.getState().project);
    expect(after.preflight.ok).toBe(before.preflight.ok);
    expect(after.gcode).toBe(before.gcode);
  });
});
