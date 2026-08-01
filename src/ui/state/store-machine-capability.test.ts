import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject, type CncTool } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => resetStore());
afterEach(() => resetStore());

describe('project lifecycle machine capability', () => {
  it('keeps a CNC-only profile in CNC mode after New Project', () => {
    const device = {
      ...useStore.getState().project.device,
      capabilities: ['cnc-output'] as const,
      cncSubProfile: { ...DEFAULT_CNC_MACHINE_CONFIG.params, safeZMm: 13 },
    };
    useStore.setState({ project: createProject(device) });

    useStore.getState().newProject();

    const machine = useStore.getState().project.machine;
    expect(machine?.kind).toBe('cnc');
    if (machine?.kind !== 'cnc') throw new Error('expected CNC machine');
    expect(machine.params.safeZMm).toBe(13);
  });

  it('repairs and preserves CNC state when opening a contradictory laser-only project', () => {
    const cnc = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, safeZMm: 21 },
    };
    const project = {
      ...createProject({
        ...useStore.getState().project.device,
        capabilities: ['laser-output'],
      }),
      machine: cnc,
    };

    const result = useStore.getState().setProject(project);

    expect(result).toMatchObject({
      kind: 'capability-repaired',
      previousKind: 'cnc',
      activeKind: 'laser',
      preservedCnc: true,
    });
    expect(useStore.getState().project.machine?.kind).toBe('laser');
    expect(useStore.getState().cachedCncMachine?.params.safeZMm).toBe(21);
    expect(useStore.getState().dirty).toBe(true);
  });

  it('enriches an opened matching CNC project from the app library without marking it repaired', () => {
    const savedTool: CncTool = {
      id: 'saved-tool',
      name: 'Saved 4 mm cutter',
      kind: 'end-mill',
      diameterMm: 4,
      catalogId: 'saved-flat-4',
    };
    const legacyTools = DEFAULT_CNC_MACHINE_CONFIG.tools.filter(
      (tool) => !tool.id.startsWith('vb-90-') || !tool.id.endsWith('-hobby'),
    );
    useStore.setState((state) => ({
      cncLibrary: { ...state.cncLibrary, customTools: [savedTool] },
    }));

    const result = useStore.getState().setProject({
      ...createProject(),
      machine: { ...DEFAULT_CNC_MACHINE_CONFIG, toolId: 'em-6350', tools: legacyTools },
    });
    const machine = useStore.getState().project.machine;
    if (machine?.kind !== 'cnc') throw new Error('expected CNC machine');

    expect(result).toEqual({ kind: 'loaded' });
    expect(machine.toolId).toBe('em-6350');
    expect(machine.tools.slice(0, legacyTools.length)).toEqual(legacyTools);
    expect(machine.tools.map((tool) => tool.id)).toEqual(
      expect.arrayContaining(['vb-90-6350-hobby', 'vb-90-12700-hobby', savedTool.id]),
    );
    expect(useStore.getState().dirty).toBe(false);
  });
});
