import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG, LASER_MACHINE_CONFIG, createProject } from '../../core/scene';
import { resolveProjectMachineCapability } from './project-machine-capability';

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
});
