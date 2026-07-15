import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../scene';
import { runStandaloneCncPreflight } from './standalone-cnc-preflight';

const DEVICE = { ...DEFAULT_DEVICE_PROFILE, bedWidth: 400, bedHeight: 400, maxFeed: 2000 };
const VALID_BODY = [
  'G21',
  'G90',
  'G0 Z3.810',
  'M3 S12000',
  'G4 P3.000',
  'G0 X0.000 Y0.000',
  'G1 Z-0.500 F300.000',
  'G1 X100.000 F1000.000',
  'G0 Z3.810',
  'M5',
  'G0 X0.000 Y0.000',
].join('\n');

describe('runStandaloneCncPreflight', () => {
  it('accepts a work-origin program that satisfies CNC text invariants', () => {
    expect(runStandaloneCncPreflight(DEVICE, DEFAULT_CNC_MACHINE_CONFIG, VALID_BODY)).toEqual({
      ok: true,
      issues: [],
    });
  });

  it('blocks a stationary spindle start before safe-Z clearance', () => {
    const unsafe = VALID_BODY.replace('G0 Z3.810\nM3 S12000', 'M3 S12000\nG0 Z3.810');
    const result = runStandaloneCncPreflight(DEVICE, DEFAULT_CNC_MACHINE_CONFIG, unsafe);
    expect(result.issues).toContainEqual({
      code: 'spindle-start-before-clearance',
      message: 'Line 3: M3 spindle start occurs before any Z clearance was established.',
    });
  });

  it('enforces device feed and work-origin bed limits', () => {
    const unsafe = VALID_BODY.replace('X100.000 F1000.000', 'X401.000 F2500.000');
    const codes = runStandaloneCncPreflight(DEVICE, DEFAULT_CNC_MACHINE_CONFIG, unsafe).issues.map(
      (issue) => issue.code,
    );
    expect(codes).toContain('cnc-settings-invalid');
    expect(codes).toContain('out-of-bed');
  });

  it('does not impose a universal stock-depth cap', () => {
    const deep = VALID_BODY.replace('G1 Z-0.500 F300.000', 'G1 Z-99.000 F300.000');
    const result = runStandaloneCncPreflight(DEVICE, DEFAULT_CNC_MACHINE_CONFIG, deep);
    expect(result.issues.map((issue) => issue.code)).not.toContain('cnc-overdeep-cut');
  });

  it('fails closed when machine-coordinate no-go zones cannot be located from the file', () => {
    const device = {
      ...DEVICE,
      noGoZones: [
        { id: 'clamp', name: 'Clamp', enabled: true, x: 20, y: 20, width: 20, height: 20 },
      ],
    };
    const result = runStandaloneCncPreflight(device, DEFAULT_CNC_MACHINE_CONFIG, VALID_BODY);
    expect(result.issues[0]?.code).toBe('no-go-zone-collision');
    expect(result.issues[0]?.message).toContain('cannot prove clearance');
  });
});
