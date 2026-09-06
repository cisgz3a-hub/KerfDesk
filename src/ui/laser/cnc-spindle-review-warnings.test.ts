import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  type Project,
} from '../../core/scene';
import { detectCncMachineLimitWarnings } from './cnc-machine-limit-warnings';
import { detectMachineJobWarnings } from './machine-job-warnings';

function cncProject(requestedRpm = 12000, ceilingRpm = 6000, isOutput = true): Project {
  const layer = {
    ...createLayer({ id: 'cnc', color: '#ff0000' }),
    output: isOutput,
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, spindleRpm: requestedRpm },
  };
  return {
    ...createProject(),
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, spindleMaxRpm: ceilingRpm },
    },
    scene: { layers: [layer], objects: [] },
  };
}

describe('CNC spindle review advisories', () => {
  it.each([null, {}, { maxPowerS: 12000 }])(
    'retains the local ceiling advisory with controller settings %j',
    (settings) => {
      const [warning, ...rest] = detectCncMachineLimitWarnings(cncProject(), settings);
      expect(rest).toEqual([]);
      expect(warning).toContain('12000 RPM');
      expect(warning).toContain('6000 RPM');
      expect(warning).toContain('compiled spindle setting is limited to 6000 RPM');
      expect(warning).toContain('actual spindle RPM is not measured');
      expect(warning).not.toContain('will run at');
    },
  );

  it('reaches the production job warning collector without live settings', () => {
    expect(detectMachineJobWarnings(cncProject())).toContainEqual(
      expect.stringContaining('Spindle maximum is 6000 RPM'),
    );
  });

  it('does not infer physical speed from a live controller S scale', () => {
    const [warning] = detectCncMachineLimitWarnings(cncProject(12000, 12000), {
      maxPowerS: 1000,
    });
    expect(warning).toContain('12000 RPM');
    expect(warning).toContain('1000 RPM');
    expect(warning).toContain('PWM');
    expect(warning).toContain('actual spindle RPM is not measured');
    expect(warning).not.toContain('spins slower');
  });

  it.each([null, {}, { maxPowerS: 1000 }])('ignores non-output layers with %j', (settings) => {
    expect(detectCncMachineLimitWarnings(cncProject(12000, 6000, false), settings)).toEqual([]);
  });

  it('keeps local matching values quiet while live settings are unknown', () => {
    expect(detectCncMachineLimitWarnings(cncProject(6000, 6000), null)).toEqual([]);
  });

  it('does not introduce CNC advisories for a laser project', () => {
    expect(detectCncMachineLimitWarnings(createProject(), null)).toEqual([]);
  });

  it('leaves requested job values unchanged', () => {
    const project = cncProject();
    const before = JSON.stringify(project);
    detectCncMachineLimitWarnings(project, { maxPowerS: 1000 });
    expect(JSON.stringify(project)).toBe(before);
  });
});
