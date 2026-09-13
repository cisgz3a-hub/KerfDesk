import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { inspectorSourceMatchesProgram } from './inspector-live-source';

describe('live source identity', () => {
  it('compares file-backed UTF-8 sources across chunk boundaries without losing Unicode', async () => {
    const text = `${';'.repeat(65_533)}漢🙂\r\nG1 X20\n`;
    const source = { kind: 'blob' as const, blob: new NodeBlob([text]) as unknown as Blob };
    await expect(
      inspectorSourceMatchesProgram(source, text, new AbortController().signal),
    ).resolves.toBe(true);
    await expect(
      inspectorSourceMatchesProgram(
        source,
        text.replace('X20', 'X21'),
        new AbortController().signal,
      ),
    ).resolves.toBe(false);
  });

  it('does not accept a canceled file comparison', async () => {
    const controller = new AbortController();
    controller.abort();
    const source = { kind: 'blob' as const, blob: new NodeBlob(['G1 X20']) as unknown as Blob };
    await expect(inspectorSourceMatchesProgram(source, 'G1 X20', controller.signal)).resolves.toBe(
      false,
    );
  });
});
