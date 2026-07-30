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
});
