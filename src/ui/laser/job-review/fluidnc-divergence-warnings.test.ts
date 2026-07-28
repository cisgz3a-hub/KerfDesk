import { describe, expect, it } from 'vitest';
import { FLUIDNC_GCODE_MAX_PAYLOAD_BYTES } from '../../../core/controllers/fluidnc/fluidnc-line-limit';
import {
  detectFluidncDivergenceWarnings,
  FLUIDNC_IDENTITY_MISMATCH_WARNING_PREFIX,
  FLUIDNC_LINE_BOUNDARY_WARNING_PREFIX,
  FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX,
} from './fluidnc-divergence-warnings';

const SHORT_PROGRAM = 'G21\nG90\nM4 S0\nG1 X10 Y10 F1000\nM5\n';
const LONG_LINE = 'G1 X'.padEnd(FLUIDNC_GCODE_MAX_PAYLOAD_BYTES + 20, '0');
const LONG_PROGRAM = `G21\n${LONG_LINE}\nM5\n`;

const GRBL_INPUT = {
  configured: 'grbl-v1.1',
  active: 'grbl-v1.1',
  detected: 'grbl-v1.1',
  gcode: LONG_PROGRAM,
} as const;

describe('detectFluidncDivergenceWarnings', () => {
  it('stays silent when no identity signal says FluidNC', () => {
    expect(detectFluidncDivergenceWarnings(GRBL_INPUT)).toEqual([]);
    expect(detectFluidncDivergenceWarnings({ ...GRBL_INPUT, detected: null })).toEqual([]);
  });

  it('keeps active-driver authority when only configured or detected identity is FluidNC', () => {
    const configured = detectFluidncDivergenceWarnings({ ...GRBL_INPUT, configured: 'fluidnc' });
    const detected = detectFluidncDivergenceWarnings({ ...GRBL_INPUT, detected: 'fluidnc' });
    expect(configured.some((w) => w.startsWith(FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX))).toBe(
      true,
    );
    expect(configured.some((w) => w.startsWith(FLUIDNC_LINE_BOUNDARY_WARNING_PREFIX))).toBe(false);
    expect(detected.some((w) => w.startsWith(FLUIDNC_IDENTITY_MISMATCH_WARNING_PREFIX))).toBe(true);
    expect(detected.join(' ')).toContain('does not switch');
  });

  it('states that active FluidNC blocks numeric setting writes', () => {
    const warnings = detectFluidncDivergenceWarnings({
      ...GRBL_INPUT,
      active: 'fluidnc',
      gcode: SHORT_PROGRAM,
    });
    const readOnly = warnings.find((w) => w.startsWith(FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX));
    expect(readOnly).toBeDefined();
    expect(readOnly).toContain('$32');
    expect(readOnly).toContain('$30');
    expect(readOnly).toContain('162');
    expect(readOnly).toContain('does not send numeric $ setting writes');
  });

  it('reports parser rejection rather than silent truncation for ordinary G-code', () => {
    const warnings = detectFluidncDivergenceWarnings({ ...GRBL_INPUT, active: 'fluidnc' });
    const boundary = warnings.find((w) => w.startsWith(FLUIDNC_LINE_BOUNDARY_WARNING_PREFIX));
    expect(boundary).toBeDefined();
    expect(boundary).toContain('line 2');
    expect(boundary).toContain(String(FLUIDNC_GCODE_MAX_PAYLOAD_BYTES + 20));
    expect(boundary).toContain(String(FLUIDNC_GCODE_MAX_PAYLOAD_BYTES));
    expect(boundary).toContain('error:14');
    expect(boundary).not.toContain('silently');
  });

  it('omits the line-boundary warning when every line fits', () => {
    const warnings = detectFluidncDivergenceWarnings({
      ...GRBL_INPUT,
      active: 'fluidnc',
      gcode: SHORT_PROGRAM,
    });
    expect(warnings.some((w) => w.startsWith(FLUIDNC_LINE_BOUNDARY_WARNING_PREFIX))).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it('puts the job-specific line-boundary warning ahead of the standing settings notice', () => {
    const warnings = detectFluidncDivergenceWarnings({ ...GRBL_INPUT, active: 'fluidnc' });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.startsWith(FLUIDNC_LINE_BOUNDARY_WARNING_PREFIX)).toBe(true);
    expect(warnings[1]?.startsWith(FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX)).toBe(true);
  });
});
