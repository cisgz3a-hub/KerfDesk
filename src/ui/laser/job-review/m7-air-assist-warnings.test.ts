import { describe, expect, it } from 'vitest';
import type { GrblBuildInfo, StockGrblOption } from '../../../core/controllers/grbl/build-info';
import { gcodeUsesM7 } from '../../../core/preflight/m7-air-assist-readiness';
import { detectM7AirAssistWarnings } from './m7-air-assist-warnings';

const M7_PROGRAM = 'G21\nG90\nM7\nM3 S0\nG1 X10 Y10 F1000\nM9\nM5\n';
const M8_PROGRAM = 'G21\nG90\nM8\nM3 S0\nG1 X10 Y10 F1000\nM9\nM5\n';

function buildInfo(optionCodes: ReadonlyArray<StockGrblOption>): GrblBuildInfo {
  return {
    protocolVersion: '1.1h',
    buildRevision: '20190830',
    userInfo: '',
    optionCodes,
    plannerBufferBlocks: 15,
    rxBufferBytes: 128,
  };
}

describe('detectM7AirAssistWarnings', () => {
  it('keeps missing build evidence explicit and review-grade', () => {
    const warnings = detectM7AirAssistWarnings(M7_PROGRAM, null, false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('could not verify M7 support');
  });

  it('reports a current stock build that proves M7 is unsupported', () => {
    const warnings = detectM7AirAssistWarnings(M7_PROGRAM, buildInfo(['V']), true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('[OPT] does not include M');
  });

  it('stays silent when current stock build information includes option M', () => {
    expect(detectM7AirAssistWarnings(M7_PROGRAM, buildInfo(['V', 'M']), true)).toEqual([]);
  });

  it('stays silent when the exact program has no M7', () => {
    expect(detectM7AirAssistWarnings(M8_PROGRAM, null, false)).toEqual([]);
    expect(detectM7AirAssistWarnings('', null, false)).toEqual([]);
  });

  it('detects numbered and combined M7 words while ignoring comments and M70', () => {
    expect(gcodeUsesM7('N10 G1 X5 M7\n')).toBe(true);
    expect(gcodeUsesM7('M07.0\n')).toBe(true);
    expect(gcodeUsesM7('M 7\n')).toBe(true);
    expect(gcodeUsesM7('M\t07.0\n')).toBe(true);
    expect(gcodeUsesM7('M(controller comment) 7\n')).toBe(true);
    expect(gcodeUsesM7('; M7\nG1 X5 (M7)\nM70\n')).toBe(false);
    expect(gcodeUsesM7('M 7 0\n')).toBe(false);
  });
});
