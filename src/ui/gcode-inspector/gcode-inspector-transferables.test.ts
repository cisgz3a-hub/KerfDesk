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

  it('still transfers the source index for a parse error', () => {
    const result = inspectGcodeText('not gcode');
    expect(gcodeInspectorTransferables(result)).toEqual([result.sourceIndex.starts.buffer]);
  });
});
