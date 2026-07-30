import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { parseGcodeProgram } from '../../io/gcode';
import { parseGcodeBlob } from './parse-gcode-blob';

describe('parseGcodeBlob', () => {
  it('streams production Blob input into the line parser without changing the result', async () => {
    const text = ['G21 G90', 'G0 X1 Y2', 'G1 X5 Y2', 'G2 X7 Y4 I0 J2', ''].join('\r\n');
    const progress = vi.fn();

    // jsdom's Blob does not expose Blob.stream(); Node's standards-compatible
    // implementation exercises the same production stream contract.
    const result = await parseGcodeBlob(new NodeBlob([text]) as unknown as Blob, progress);

    expect(result).toEqual(parseGcodeProgram(text));
    expect(progress).toHaveBeenLastCalledWith({ bytesRead: text.length, totalBytes: text.length });
  });
});
