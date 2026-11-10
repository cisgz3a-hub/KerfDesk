import { describe, expect, it } from 'vitest';
import { settingsMapToControllerSettings } from './parse-settings';
import { buildResumeProgram } from './resume-program';
import { parseStatusReport } from './status-parser';

// ADR-695 Amendment 1 (rolling audit v13 Y5-P1-2): Start from line on an A
// or Z rotary program turns the part back to the job's zero, zeroes it, and
// moves to the line's turn, all with the beam off, before the replay.
const A_PROGRAM = [
  'G92 A0',
  'G21',
  'G90',
  'M4 S0',
  'G0 X10 A0',
  'G1 X10 A45 F1500 S300',
  'G1 X20 A45',
  'G0 X30 A10 S0',
  'G1 X30 A90 S300',
  'M5',
].join('\n');

const OPTIONS = {
  machineKind: 'laser',
  safeZMm: 0,
  spindleSpinupSec: 0,
  plungeMmPerMin: 300,
} as const;

describe('Start from line on a dedicated-axis rotary', () => {
  it('re-enters at the job zero and the line turn before the replayed burn', () => {
    const resume = buildResumeProgram(A_PROGRAM, 9, {
      ...OPTIONS,
      rotaryZero: { axis: 'A', machine: 37.5 },
    });
    if (resume.kind !== 'ok') throw new Error(resume.reason);
    const preamble = resume.lines.slice(0, resume.preambleCount);
    const m5 = preamble.indexOf('M5');
    expect(preamble.slice(m5 + 1, m5 + 4)).toEqual(['G53 G0 A37.500', 'G92 A0', 'G0 A10.000 S0']);
    // The X re-entry and the beam re-arm still follow, beam off.
    expect(preamble.some((line) => line.startsWith('G0 X30'))).toBe(true);
    expect(resume.lines[resume.preambleCount]).toMatch(/^G1 X30 A90/);
  });

  it('refuses without the turn the job started from, rather than burn a streak', () => {
    const resume = buildResumeProgram(A_PROGRAM, 9, OPTIONS);
    expect(resume.kind).toBe('error');
    expect(resume.kind === 'error' ? resume.reason : '').toContain('turn the job started from');
  });

  it('leaves a Y-port program as it was', () => {
    const yProgram = A_PROGRAM.replace('G92 A0\n', '').replace(/A/g, 'Y');
    const resume = buildResumeProgram(yProgram, 8, OPTIONS);
    if (resume.kind !== 'ok') throw new Error(resume.reason);
    expect(resume.lines.some((line) => line.startsWith('G53') || line.startsWith('G92'))).toBe(
      false,
    );
  });
});

describe('the controller facts a rotary on A needs', () => {
  it('keeps A from a four-axis status report', () => {
    const report = parseStatusReport('<Idle|MPos:1.000,2.000,3.000,160.428|FS:0,0|WCO:0,0,0,37.5>');
    expect(report?.mPos).toEqual({ x: 1, y: 2, z: 3, a: 160.428 });
    expect(report?.wco).toEqual({ x: 0, y: 0, z: 0, a: 37.5 });
    expect(parseStatusReport('<Idle|MPos:1.000,2.000,3.000|FS:0,0>')?.mPos).toEqual({
      x: 1,
      y: 2,
      z: 3,
    });
  });

  it('reads the Z and A max rates', () => {
    const settings = settingsMapToControllerSettings(
      new Map([
        [110, '36000'],
        [112, '2000'],
        [113, '36000'],
      ]),
    );
    expect(settings.maxRateZ).toBe(2000);
    expect(settings.maxRateA).toBe(36000);
  });
});
