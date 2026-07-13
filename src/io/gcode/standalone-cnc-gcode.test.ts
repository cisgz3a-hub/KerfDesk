import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { emitStandaloneCncGcode } from './standalone-cnc-gcode';
import type { GcodeMetadata } from './gcode-metadata';

const BODY = [
  'G21',
  'G90',
  'G0 Z3.810',
  'M3 S12000',
  'G1 Z-0.500 F300.000',
  'G1 X10.000 F1000.000',
  'G0 Z3.810',
  'M5',
].join('\n');
const METADATA: GcodeMetadata = {
  appName: 'KerfDesk',
  appVersion: '1.2.3',
  gitSha: 'abc123',
  buildTimeUtc: '2026-07-13T00:00:00Z',
  emitterRevision: 'surfacing-test',
};

function cncProject() {
  return {
    ...createProject({ ...DEFAULT_DEVICE_PROFILE, maxFeed: 2000 }),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
  };
}

describe('emitStandaloneCncGcode', () => {
  it('preflights the body and prepends the normal CNC provenance header', () => {
    const result = emitStandaloneCncGcode(cncProject(), BODY, METADATA);
    expect(result.preflight).toEqual({ ok: true, issues: [] });
    expect(result.gcode).toContain('; KerfDesk\n; version: 1.2.3');
    expect(result.gcode).toContain('; emitter: surfacing-test');
    expect(result.gcode).toContain('; assumes: GRBL $30=12000');
    expect(result.gcode.indexOf('G0 Z3.810')).toBeLessThan(result.gcode.indexOf('M3 S12000'));
    expect(result.gcode.endsWith('\n')).toBe(true);
  });

  it('refuses a standalone CNC wrapper without CNC machine configuration', () => {
    const result = emitStandaloneCncGcode(createProject(), BODY, METADATA);
    expect(result.gcode).toBe('');
    expect(result.preflight.ok).toBe(false);
    expect(result.preflight.issues[0]?.code).toBe('cnc-settings-invalid');
  });
});
