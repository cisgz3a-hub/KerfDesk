import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { inspectGcodeSource, inspectGcodeText } from './gcode-inspector-parse';

describe('inspectGcodeSource', () => {
  it('streams Blob input while preserving render and source-line results', async () => {
    const text = ['G21 G90', 'G0 X1 Y2', 'G1 X4 Y2', 'M2', ''].join('\r\n');
    const progress = vi.fn();

    const streamed = await inspectGcodeSource(
      { kind: 'blob', blob: new NodeBlob([text]) as unknown as Blob },
      progress,
    );

    expect(streamed).toEqual(inspectGcodeText(text));
    expect(progress).toHaveBeenLastCalledWith({ bytesRead: text.length, totalBytes: text.length });
  });

  it('retains every source line instead of capping the source pane', () => {
    const text = Array.from({ length: 20_005 }, (_, index) => `G1 X${index}`).join('\n');
    const result = inspectGcodeText(text);

    expect(result.sourceLineCount).toBe(20_005);
    expect(result.lines).toHaveLength(20_005);
  });
});
