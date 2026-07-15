import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../../core/scene';
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
});
