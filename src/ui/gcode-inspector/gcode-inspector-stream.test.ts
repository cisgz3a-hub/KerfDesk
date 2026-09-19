import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { iterateLines } from '../../core/util';
import { inspectGcodeSource, inspectGcodeText } from './gcode-inspector-parse';
import { readGcodeSourceLines } from './gcode-source-line-index';

describe('inspectGcodeSource', () => {
  it.each(['laser', 'cnc'] as const)(
    'preserves %s context for text and streamed Blob input',
    async (machineKind) => {
      const text = 'M4 S0\nG1 X3 F1500\nX23 S300\nX26 S0';
      const context = { machineKind };
      const direct = inspectGcodeText(text, context);
      const textSource = await inspectGcodeSource({ kind: 'text', text, ...context });
      const streamed = await inspectGcodeSource({
        kind: 'blob',
        blob: new NodeBlob([text]) as unknown as Blob,
        ...context,
      });
      expect(textSource.parsed).toEqual(direct.parsed);
      expect(streamed.parsed).toEqual(direct.parsed);
      expect(direct.parsed.kind).toBe('ok');
      if (direct.parsed.kind !== 'ok') return;
      expect(direct.parsed.model.stats.cutMm).toBe(machineKind === 'laser' ? 20 : 26);
    },
  );

  it('streams Blob input while preserving render and source-line results', async () => {
    const text = ['G21 G90', 'G0 X1 Y2', 'G1 X4 Y2', 'M2', ''].join('\r\n');
    const progress = vi.fn();

    const source = { kind: 'blob' as const, blob: new NodeBlob([text]) as unknown as Blob };
    const streamed = await inspectGcodeSource(source, progress);
    const direct = inspectGcodeText(text);

    expect(streamed.parsed).toEqual(direct.parsed);
    expect(streamed.analysis).toEqual(direct.analysis);
    expect(streamed.sourceLineCount).toBe(direct.sourceLineCount);
    await expect(
      readGcodeSourceLines(source, streamed.sourceIndex, 0, streamed.sourceLineCount),
    ).resolves.toEqual(Array.from(iterateLines(text)));
    expect(progress).toHaveBeenLastCalledWith({ bytesRead: text.length, totalBytes: text.length });
  });

  it('indexes every source line without retaining a cloned string array', () => {
    const text = Array.from({ length: 20_005 }, (_, index) => `G1 X${index}`).join('\n');
    const result = inspectGcodeText(text);
    const indexed = result as unknown as {
      readonly sourceIndex?: { readonly starts: Float64Array };
      readonly lines?: ReadonlyArray<string>;
    };

    expect(result.sourceLineCount).toBe(20_005);
    expect(indexed.sourceIndex?.starts).toBeInstanceOf(Float64Array);
    expect(indexed.sourceIndex?.starts).toHaveLength(20_005);
    expect(indexed).not.toHaveProperty('lines');
  });
});
