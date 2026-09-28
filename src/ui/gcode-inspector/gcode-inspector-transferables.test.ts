import { describe, expect, it } from 'vitest';
import { inspectGcodeText } from './gcode-inspector-parse';
import { gcodeInspectorTransferables } from './gcode-inspector-transferables';
import { hasGcodeInspectorAnalysis } from './gcode-inspector-worker-protocol';

describe('gcodeInspectorTransferables', () => {
  it('returns every typed render buffer exactly once', () => {
    const result = inspectGcodeText('G21 G90\nG0 X1\nG1 X2');
    expect(hasGcodeInspectorAnalysis(result)).toBe(true);
    if (!hasGcodeInspectorAnalysis(result)) return;

    const transfers = gcodeInspectorTransferables(result);
    expect(transfers).toHaveLength(11);
    expect(new Set(transfers).size).toBe(transfers.length);
    expect(transfers).toContain(result.sourceIndex.starts.buffer);
    expect(transfers).toContain(result.parsed.model.positions.buffer);
    expect(transfers).toContain(result.parsed.model.lineCategories.buffer);
    expect(transfers).toContain(result.analysis.time.segTimeEndSec.buffer);
    expect(transfers).toContain(result.analysis.time.segFeedLimited.buffer);
    expect(transfers).toContain(result.analysis.time.kindSeconds.buffer);
  });

  it('leaves the arrays only timing used in the worker (ADR-485)', () => {
    const result = inspectGcodeText('G21 G90\nG0 X1\nG1 X2 F600');
    if (!hasGcodeInspectorAnalysis(result)) throw new Error('Expected a parsed program');
    for (const dropped of ['segRouteEndMm', 'segLengthMm']) {
      expect(result.parsed.model).not.toHaveProperty(dropped);
    }
    for (const dropped of [
      'segSeconds',
      'segTimeScale',
      'segDistanceMm',
      'segTargetVelocityMmPerSec',
      'segEntryVelocityMmPerSec',
      'segExitVelocityMmPerSec',
    ]) {
      expect(result.analysis.time).not.toHaveProperty(dropped);
    }
  });

  it('hands over the simplified drawings a big program gets (ADR-485)', () => {
    const cut = Array.from({ length: 100_000 }, (_, index) => `X${((index + 1) / 100).toFixed(2)}`);
    const result = inspectGcodeText(`G21 G90\nG0 X0 Y0\nG1 F600\n${cut.join('\n')}`);
    if (!hasGcodeInspectorAnalysis(result)) throw new Error('Expected a parsed program');
    const detail = result.parsed.model.detail;
    expect(detail?.solidMoves).toBe(100_000);
    const levels = detail?.levels ?? [];
    expect(levels.length).toBeGreaterThan(0);
    const transfers = gcodeInspectorTransferables(result);
    expect(transfers).toHaveLength(11 + levels.length * 2);
    for (const level of levels) {
      expect(transfers).toContain(level.starts.buffer);
      expect(transfers).toContain(level.ends.buffer);
    }
    const small = inspectGcodeText('G21 G90\nG1 X2 F600');
    if (!hasGcodeInspectorAnalysis(small)) throw new Error('Expected a parsed program');
    expect(small.parsed.model).not.toHaveProperty('detail');
  });

  it('still transfers the source index for a parse error', () => {
    const result = inspectGcodeText('not gcode');
    expect(gcodeInspectorTransferables(result)).toEqual([result.sourceIndex.starts.buffer]);
  });
});
