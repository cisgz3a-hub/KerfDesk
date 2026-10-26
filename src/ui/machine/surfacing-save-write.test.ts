import { describe, expect, it, vi } from 'vitest';
import type { SaveTarget } from '../../platform/types';
import { blobText } from '../../platform/web/chromium-save-picker.test-support';
import { stageSurfacingProgram, writeSurfacingFile } from './surfacing-save-write';

function chunksOf(...texts: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of texts) yield text;
    },
  };
}

describe('surfacing program staging', () => {
  it('collects every chunk in order before a destination is chosen', async () => {
    const program = await stageSurfacingProgram(
      chunksOf('G21\n', 'G90\n', 'M5\n'),
      new AbortController().signal,
    );
    expect(await blobText(program)).toBe('G21\nG90\nM5\n');
  });

  it('stops generating when the save is cancelled', async () => {
    const controller = new AbortController();
    const pulled: string[] = [];
    const chunks = {
      async *[Symbol.asyncIterator]() {
        for (const text of ['G21\n', 'G90\n', 'M5\n']) {
          pulled.push(text);
          yield text;
          controller.abort();
        }
      },
    };
    await expect(stageSurfacingProgram(chunks, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    // The chunk in flight when Cancel lands is the last one pulled.
    expect(pulled).toEqual(['G21\n', 'G90\n']);
  });
});

describe('surfacing save commit ownership', () => {
  it('settles an old final commit before a replacement opens its writer', async () => {
    let finishOldClose: () => void = () => undefined;
    const oldClose = new Promise<void>((resolve) => {
      finishOldClose = resolve;
    });
    const committed: string[] = [];
    const old: SaveTarget = {
      displayName: 'same.nc',
      write: async () => {
        await oldClose;
        committed.push('old');
      },
    };
    const replacementWrite = vi.fn(async () => {
      committed.push('new');
    });
    const replacement: SaveTarget = { displayName: 'same.nc', write: replacementWrite };
    const first = writeSurfacingFile(old, new Blob(['old']));
    const second = writeSurfacingFile(replacement, new Blob(['new']));
    await Promise.resolve();
    expect(replacementWrite).not.toHaveBeenCalled();
    finishOldClose();
    await Promise.all([first, second]);
    expect(committed).toEqual(['old', 'new']);
  });

  it('releases the next save after a write failure', async () => {
    const failedTarget: SaveTarget = {
      displayName: 'failed.nc',
      write: async () => {
        throw new Error('disk full');
      },
    };
    await expect(writeSurfacingFile(failedTarget, new Blob(['x']))).rejects.toThrow('disk full');
    const finalWrite = vi.fn(async () => undefined);
    await writeSurfacingFile({ displayName: 'last.nc', write: finalWrite }, new Blob(['y']));
    expect(finalWrite).toHaveBeenCalledOnce();
  });
});
