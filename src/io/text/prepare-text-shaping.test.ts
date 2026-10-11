import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('harfbuzzjs');
  vi.resetModules();
});

describe('multilingual text runtime ownership', () => {
  it('does not load WASM for the established Latin route', async () => {
    vi.doMock('harfbuzzjs', () => {
      throw new Error('must stay lazy');
    });
    const { prepareTextShaping } = await import('./prepare-text-shaping');
    await expect(prepareTextShaping(new ArrayBuffer(0), 'Crème office ✓')).resolves.toBeUndefined();
  });

  it('asks for reload after startup failure without returning legacy geometry', async () => {
    vi.doMock('harfbuzzjs', () => {
      throw new Error('WASM unavailable');
    });
    const { prepareTextShaping } = await import('./prepare-text-shaping');
    const bytes = readFileSync(resolve(__dirname, '../../ui/text/fonts/Tinos-Regular.ttf'));
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    await expect(prepareTextShaping(buffer, 'שלום')).rejects.toThrow('Reload KerfDesk to retry');
  });
});
