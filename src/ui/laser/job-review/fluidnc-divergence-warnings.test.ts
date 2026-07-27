import { describe, expect, it } from 'vitest';
import { FLUIDNC_MAX_LINE_CHARS } from '../../../core/controllers/fluidnc/fluidnc-line-limit';
import {
  detectFluidncDivergenceWarnings,
  FLUIDNC_LINE_TRUNCATION_WARNING_PREFIX,
  FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX,
} from './fluidnc-divergence-warnings';

const SHORT_PROGRAM = 'G21\nG90\nM4 S0\nG1 X10 Y10 F1000\nM5\n';
const LONG_LINE = 'G1 X'.padEnd(FLUIDNC_MAX_LINE_CHARS + 20, '0');
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

  it('fires when any of the configured, active, or detected identity is FluidNC', () => {
    for (const override of [
      { configured: 'fluidnc' },
      { active: 'fluidnc' },
      { detected: 'fluidnc' },
    ] as const) {
      const warnings = detectFluidncDivergenceWarnings({ ...GRBL_INPUT, ...override });
      expect(warnings.some((w) => w.startsWith(FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX))).toBe(
        true,
      );
    }
  });

  it('always discloses that $32 and $30 are read-only mirrors answering error 162', () => {
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
    // Rule 7: the disclosure must state that KerfDesk still sends the write.
    expect(readOnly).toContain('still sends');
  });

  it('reports silently truncated lines with their number and length', () => {
    const warnings = detectFluidncDivergenceWarnings({ ...GRBL_INPUT, active: 'fluidnc' });
    const truncation = warnings.find((w) => w.startsWith(FLUIDNC_LINE_TRUNCATION_WARNING_PREFIX));
    expect(truncation).toBeDefined();
    expect(truncation).toContain('line 2');
    expect(truncation).toContain(String(FLUIDNC_MAX_LINE_CHARS + 20));
    expect(truncation).toContain(String(FLUIDNC_MAX_LINE_CHARS));
    expect(truncation).toContain('no error');
    // Rule 7: never truncate, split, or reject — emit and inform.
    expect(truncation).toContain('exactly as compiled');
  });

  it('omits the truncation warning when every line fits', () => {
    const warnings = detectFluidncDivergenceWarnings({
      ...GRBL_INPUT,
      active: 'fluidnc',
      gcode: SHORT_PROGRAM,
    });
    expect(warnings.some((w) => w.startsWith(FLUIDNC_LINE_TRUNCATION_WARNING_PREFIX))).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it('puts the job-specific truncation warning ahead of the standing settings notice', () => {
    const warnings = detectFluidncDivergenceWarnings({ ...GRBL_INPUT, active: 'fluidnc' });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.startsWith(FLUIDNC_LINE_TRUNCATION_WARNING_PREFIX)).toBe(true);
    expect(warnings[1]?.startsWith(FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX)).toBe(true);
  });
});
