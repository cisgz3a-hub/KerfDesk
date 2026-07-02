import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  type CncLayerSettings,
  type Project,
} from '../scene';
import { runCncPreflight } from './cnc-preflight';

const config = DEFAULT_CNC_MACHINE_CONFIG;

const GOOD_GCODE = [
  'G21',
  'G90',
  'G94',
  'M3 S12000',
  'G0 Z3.810',
  'G0 X10.000 Y10.000',
  'G1 Z-1.000 F300',
  'G1 X20.000 Y10.000 F1000',
  'G0 Z3.810',
  'M5',
  'G0 X0.000 Y0.000',
].join('\n');

function projectWithCnc(cnc: Partial<CncLayerSettings> = {}): Project {
  const base = createProject();
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc },
  };
  return { ...base, scene: { ...base.scene, layers: [layer] } };
}

describe('runCncPreflight', () => {
  it('passes a sane project and safe G-code', () => {
    const result = runCncPreflight(projectWithCnc(), config, GOOD_GCODE);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('flags a missing output layer', () => {
    const base = createProject();
    const result = runCncPreflight(base, config, GOOD_GCODE);
    expect(result.issues.some((issue) => issue.code === 'no-output-layer')).toBe(true);
  });

  it('flags non-positive depths', () => {
    const result = runCncPreflight(projectWithCnc({ depthMm: 0 }), config, GOOD_GCODE);
    expect(result.issues.some((issue) => issue.code === 'cnc-settings-invalid')).toBe(true);
  });

  it('flags a spindle speed above the machine maximum', () => {
    const result = runCncPreflight(projectWithCnc({ spindleRpm: 99999 }), config, GOOD_GCODE);
    expect(result.issues.some((issue) => issue.code === 'cnc-settings-invalid')).toBe(true);
  });

  it('flags v-carve when the active bit is not a v-bit (H.3)', () => {
    // Default config's active tool is the 1/8 in end mill.
    const result = runCncPreflight(projectWithCnc({ cutType: 'v-carve' }), config, GOOD_GCODE);
    expect(result.issues.some((issue) => issue.message.includes('V-carve requires a v-bit'))).toBe(
      true,
    );
    expect(result.ok).toBe(false);
  });

  it('accepts v-carve when a v-bit is active (H.3)', () => {
    const vbitConfig = { ...config, toolId: 'vb-60' };
    const result = runCncPreflight(projectWithCnc({ cutType: 'v-carve' }), vbitConfig, GOOD_GCODE);
    expect(result.issues.some((issue) => issue.message.includes('V-carve requires'))).toBe(false);
  });

  it('flags emitted Z below the stock floor even when settings look sane (H.1)', () => {
    // Settings say 1 mm deep, but the emitted text plunges through the
    // spoilboard — the text-level invariant catches what settings cannot.
    const overdeep = GOOD_GCODE.replace('G1 Z-1.000 F300', 'G1 Z-99.000 F300');
    const result = runCncPreflight(projectWithCnc({ depthMm: 1 }), config, overdeep);
    expect(result.issues.some((issue) => issue.code === 'cnc-overdeep-cut')).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('flags cut depth far beyond the stock thickness', () => {
    const result = runCncPreflight(projectWithCnc({ depthMm: 20 }), config, GOOD_GCODE);
    expect(result.issues.some((issue) => issue.code === 'cnc-depth-exceeds-stock')).toBe(true);
  });

  it('allows a through-cut slightly past the stock bottom', () => {
    const depthMm = config.stock.thicknessMm + 0.5;
    const result = runCncPreflight(projectWithCnc({ depthMm }), config, GOOD_GCODE);
    expect(result.issues.some((issue) => issue.code === 'cnc-depth-exceeds-stock')).toBe(false);
  });

  it('flags plunged XY rapids in the emitted motion', () => {
    const plunged = ['G0 Z3.810', 'G1 Z-2.000 F300', 'G0 X50.000 Y50.000', 'G1 X1 Y1 F100'].join(
      '\n',
    );
    const result = runCncPreflight(projectWithCnc(), config, plunged);
    expect(result.issues.some((issue) => issue.code === 'plunged-travel')).toBe(true);
  });

  it('flags out-of-bed motion', () => {
    const outOfBed = GOOD_GCODE.replace('G1 X20.000 Y10.000 F1000', 'G1 X9999.000 Y10.000 F1000');
    const result = runCncPreflight(projectWithCnc(), config, outOfBed);
    expect(result.issues.some((issue) => issue.code === 'out-of-bed')).toBe(true);
  });

  it('flags empty output', () => {
    const result = runCncPreflight(projectWithCnc(), config, 'G21\nM5');
    expect(result.issues.some((issue) => issue.code === 'empty-output')).toBe(true);
  });
});
