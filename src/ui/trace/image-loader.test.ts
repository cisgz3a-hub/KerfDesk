import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_MAX_EDGE_PX,
  compositeRgbOverWhitePreservingAlpha,
  dataUrlToFile,
  loadImageAsRawData,
  readImageNaturalSize,
  readFileAsDataUrl,
  scaleToCap,
} from './image-loader';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => resolve(String(reader.result ?? ''));
    reader.onerror = (): void => reject(new Error('FileReader failed.'));
    reader.readAsText(file);
  });
}

function pngFileWithSize(width: number, height: number): File {
  const bytes = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // signature
    0x00,
    0x00,
    0x00,
    0x0d, // IHDR length
    0x49,
    0x48,
    0x44,
    0x52, // IHDR
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
    0x08, // bit depth
    0x06, // color type
    0x00, // compression
    0x00, // filter
    0x00, // interlace
    0x00,
    0x00,
    0x00,
    0x00, // ignored CRC
  ]);
  return new File([bytes], 'source.png', { type: 'image/png' });
}

function stubObjectUrlDecode(width: number, height: number): () => void {
  const createObjectURL = vi.fn(() => 'blob:test');
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  class FakeImage {
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    public width = width;
    public height = height;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', FakeImage);
  return () => expect(createObjectURL).not.toHaveBeenCalled();
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

describe('image-loader header guards', () => {
  it('asks ImageBitmap to resize a large source during decode', async () => {
    const file = pngFileWithSize(4096, 2048);
    const bitmap = {
      width: 2048,
      height: 1024,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const createObjectURL = vi.fn(() => 'blob:fallback');
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
    });

    const image = await loadImageAsRawData(file);

    expect(createImageBitmap).toHaveBeenCalledWith(file, {
      resizeWidth: 2048,
      resizeHeight: 1024,
      resizeQuality: 'high',
    });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(image).toMatchObject({ width: 2048, height: 1024 });
  });

  it('reads PNG natural dimensions from the header without browser decode', async () => {
    const expectNoObjectUrlDecode = stubObjectUrlDecode(1, 1);

    await expect(readImageNaturalSize(pngFileWithSize(640, 480))).resolves.toEqual({
      width: 640,
      height: 480,
    });
    expectNoObjectUrlDecode();
  });

  it('rejects unsafe PNG source dimensions before creating an object URL', async () => {
    const expectNoObjectUrlDecode = stubObjectUrlDecode(1, 1);

    await expect(loadImageAsRawData(pngFileWithSize(100_000, 100_000))).rejects.toThrow(
      /too large to decode safely/i,
    );
    expectNoObjectUrlDecode();
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
