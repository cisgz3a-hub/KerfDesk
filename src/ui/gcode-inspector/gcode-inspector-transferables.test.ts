import { describe, expect, it } from 'vitest';
import { inspectGcodeText } from './gcode-inspector-parse';
import { gcodeInspectorTransferables } from './gcode-inspector-transferables';

describe('gcodeInspectorTransferables', () => {
  it('returns every typed render buffer exactly once', () => {
    const result = inspectGcodeText('G21 G90\nG0 X1\nG1 X2');
    expect(result.parsed.kind).toBe('ok');
    if (result.parsed.kind !== 'ok') return;

    const transfers = gcodeInspectorTransferables(result);
    expect(transfers).toHaveLength(9);
    expect(new Set(transfers).size).toBe(transfers.length);
    expect(transfers).toContain(result.sourceIndex.starts.buffer);
    expect(transfers).toContain(result.parsed.model.positions.buffer);
    expect(transfers).toContain(result.parsed.model.lineCategories.buffer);
  });

  it('still transfers the source index for a parse error', () => {
    const result = inspectGcodeText('not gcode');
    expect(gcodeInspectorTransferables(result)).toEqual([result.sourceIndex.starts.buffer]);
  });
});
