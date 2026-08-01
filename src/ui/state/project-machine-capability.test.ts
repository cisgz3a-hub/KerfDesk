import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  LASER_MACHINE_CONFIG,
  createProject,
  type CncTool,
} from '../../core/scene';
import { resolveProjectMachineCapability } from './project-machine-capability';

const BACKFILLED_STARTER_IDS = ['vb-90-6350-hobby', 'vb-90-12700-hobby'] as const;

describe('project machine capability resolution', () => {
  it('repairs a laser-only project that was previously switched into CNC mode', () => {
    const project = {
      ...createProject({ ...DEFAULT_DEVICE_PROFILE, capabilities: ['laser-output'] }),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
    };

    const resolved = resolveProjectMachineCapability(project, []);

    expect(resolved.project.machine).toEqual(LASER_MACHINE_CONFIG);
    expect(resolved.cachedCncMachine).toEqual(DEFAULT_CNC_MACHINE_CONFIG);
    expect(resolved.loadResult).toEqual({
      kind: 'capability-repaired',
      previousKind: 'cnc',
      activeKind: 'laser',
      preservedCnc: true,
    });
  });

  it('starts a CNC-only project with its persisted physical CNC settings', () => {
    const cncSubProfile = { ...DEFAULT_CNC_MACHINE_CONFIG.params, safeZMm: 17 };
    const project = createProject({
      ...DEFAULT_DEVICE_PROFILE,
      capabilities: ['cnc-output'],
      cncSubProfile,
    });

    const resolved = resolveProjectMachineCapability(project, []);

    expect(resolved.project.machine?.kind).toBe('cnc');
    if (resolved.project.machine?.kind !== 'cnc') throw new Error('expected CNC machine');
    expect(resolved.project.machine.params).toEqual(cncSubProfile);
  });

  it('honors a preferred CNC mode for a new hybrid project', () => {
    const project = createProject({
      ...DEFAULT_DEVICE_PROFILE,
      capabilities: ['laser-output', 'cnc-output'],
      cncSubProfile: DEFAULT_CNC_MACHINE_CONFIG.params,
    });

    const resolved = resolveProjectMachineCapability(project, [], 'cnc');

    expect(resolved.project.machine?.kind).toBe('cnc');
  });

  it('keeps legacy profiles unrestricted', () => {
    const resolved = resolveProjectMachineCapability(
      createProject(DEFAULT_DEVICE_PROFILE),
      [],
      'cnc',
    );

    expect(resolved.project.machine?.kind).toBe('cnc');
  });

  it('adds the two catalog-backed starters to an older nonempty CNC project without replacing it', () => {
    const legacyTools = DEFAULT_CNC_MACHINE_CONFIG.tools.filter(
      (tool) =>
        !BACKFILLED_STARTER_IDS.includes(tool.id as (typeof BACKFILLED_STARTER_IDS)[number]),
    );
    const legacyMachine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      toolId: 'em-6350',
      tools: legacyTools,
    };

    const resolved = resolveProjectMachineCapability(
      { ...createProject(), machine: legacyMachine },
      [],
    );
    const machine = resolved.project.machine;
    if (machine?.kind !== 'cnc') throw new Error('expected CNC machine');

    expect(machine.toolId).toBe('em-6350');
    expect(machine.tools.slice(0, legacyTools.length)).toEqual(legacyTools);
    expect(machine.tools.slice(legacyTools.length).map((tool) => tool.id)).toEqual(
      BACKFILLED_STARTER_IDS,
    );
    expect(resolved.loadResult).toEqual({ kind: 'loaded' });
  });

  it('merges saved custom tools into a matching project by id or catalog without replacing project copies', () => {
    const projectCopy: CncTool = {
      id: 'project-copy',
      name: 'Project-owned 4 mm cutter',
      kind: 'end-mill',
      diameterMm: 4,
      catalogId: 'custom-flat-4',
    };
    const savedAlias: CncTool = {
      ...projectCopy,
      id: 'saved-alias',
      name: 'Saved alias must not replace project copy',
    };
    const savedUnique: CncTool = {
      id: 'saved-unique',
      name: 'Saved 5 mm cutter',
      kind: 'end-mill',
      diameterMm: 5,
      catalogId: 'custom-flat-5',
    };
    const projectTools = [...DEFAULT_CNC_MACHINE_CONFIG.tools, projectCopy];
    const project = {
      ...createProject(),
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        toolId: projectCopy.id,
        tools: projectTools,
      },
    };

    const resolved = resolveProjectMachineCapability(project, [savedAlias, savedUnique]);
    const machine = resolved.project.machine;
    if (machine?.kind !== 'cnc') throw new Error('expected CNC machine');

    expect(machine.toolId).toBe(projectCopy.id);
    expect(machine.tools.slice(0, projectTools.length)).toEqual(projectTools);
    expect(machine.tools.filter((tool) => tool.catalogId === projectCopy.catalogId)).toEqual([
      projectCopy,
    ]);
    expect(machine.tools.at(-1)).toEqual(savedUnique);
  });
});
