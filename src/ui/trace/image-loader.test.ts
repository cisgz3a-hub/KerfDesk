import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_MAX_EDGE_PX,
  compositeRgbOverWhitePreservingAlpha,
  dataUrlToFile,
  readFileAsDataUrl,
  scaleToCap,
} from './image-loader';

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
    // 2048 (raised from 1024, ADR-037): doubles linear resolution so small
    // traced text keeps the detail it needs to trace as smooth curves.
    expect(PREVIEW_MAX_EDGE_PX).toBe(2048);
  });
});

describe('image-loader alpha preservation', () => {
  it('makes transparent pixels white for normal trace but keeps alpha for Trace Transparency', () => {
    const image = {
      width: 3,
      height: 1,
      data: new Uint8ClampedArray([
        0,
        0,
        0,
        0, // transparent black
        0,
        0,
        0,
        128, // half-transparent black
        100,
        150,
        200,
        255, // opaque color
      ]),
    };

    const result = compositeRgbOverWhitePreservingAlpha(image);

    expect(Array.from(result.data)).toEqual([
      255, 255, 255, 0, 127, 127, 127, 128, 100, 150, 200, 255,
    ]);
  });
});

describe('image-loader scaleToCap (ADR-037 decode resolution)', () => {
  it('leaves an image at or below the cap unchanged', () => {
    expect(scaleToCap(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });

  it('preserves detail between the old 1024 cap and the new 2048 cap', () => {
    // Pre-ADR-037 this 1500px source was crushed to 1024 before potrace saw
    // it (losing small-text fidelity); the raised cap now keeps it full size.
    expect(scaleToCap(1500, 1000, 2048)).toEqual({ width: 1500, height: 1000 });
  });

  it('downscales proportionally above the cap (runtime bound preserved)', () => {
    expect(scaleToCap(4096, 2048, 2048)).toEqual({ width: 2048, height: 1024 });
  });

  it('never UPSCALES a small source — intentional pixel art stays sharp', () => {
    // Bilinear-upscaling deliberate pixel art (Sharp preset) would blur the
    // notches the user wants kept, so sub-cap images pass through untouched.
    expect(scaleToCap(300, 200, 2048)).toEqual({ width: 300, height: 200 });
  });
});

describe('image-loader data URL reconstruction', () => {
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

  it('rejects when FileReader returns a non-string result (no silent empty image)', async () => {
    const Original = globalThis.FileReader;
    class FakeReader {
      public result: unknown = null;
      public onload: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      readAsDataURL(): void {
        this.result = new ArrayBuffer(4); // non-string
        this.onload?.();
      }
    }
    globalThis.FileReader = FakeReader as unknown as typeof FileReader;
    try {
      await expect(readFileAsDataUrl(new File(['x'], 'x.png'))).rejects.toThrow('non-string');
    } finally {
      globalThis.FileReader = Original;
    }
  });
});
