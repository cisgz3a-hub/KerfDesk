import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_MAX_EDGE_PX, dataUrlToFile } from './image-loader';

afterEach(() => {
  vi.restoreAllMocks();
});

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => resolve(String(reader.result ?? ''));
    reader.onerror = (): void => reject(new Error('FileReader failed.'));
    reader.readAsText(file);
  });
}

describe('image-loader trace preview sizing', () => {
  it('uses the commit-sized decode cap so preview and committed trace see the same pixels', () => {
    expect(PREVIEW_MAX_EDGE_PX).toBe(1024);
  });

  it('reconstructs imported-image data URLs without fetch so production CSP cannot block trace', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Refused to connect because it violates connect-src'),
    );

    const file = await dataUrlToFile('data:image/png;base64,aGVsbG8=', 'source.png');

    expect(file.name).toBe('source.png');
    expect(file.type).toBe('image/png');
    expect(await readFileText(file)).toBe('hello');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
