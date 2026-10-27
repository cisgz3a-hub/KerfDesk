// Browser decoder stubs for the image loader's orientation tests: a recording
// 2D canvas, createImageBitmap, and the HTMLImageElement route.

import { vi } from 'vitest';

export type DrawCall = {
  readonly transform: ReadonlyArray<number> | null;
  readonly size: number[];
};

export function recordCanvas(): { readonly draws: DrawCall[] } {
  const draws: DrawCall[] = [];
  let transform: ReadonlyArray<number> | null = null;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const { width, height } = this;
    return {
      setTransform: (...matrix: number[]) => {
        transform = matrix.join() === '1,0,0,1,0,0' ? null : matrix;
      },
      drawImage: (_source: unknown, _x: number, _y: number, w: number, h: number) => {
        draws.push({ transform, size: [w, h] });
      },
      getImageData: () => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    } as unknown as CanvasRenderingContext2D;
  } as unknown as HTMLCanvasElement['getContext']);
  return { draws };
}

export function bitmapDecoder(respond: (width: number, height: number) => [number, number]) {
  const close = vi.fn();
  const decode = vi.fn(async (_file: Blob, options: ImageBitmapOptions) => {
    const [width, height] = respond(options.resizeWidth ?? 0, options.resizeHeight ?? 0);
    return { width, height, close } as unknown as ImageBitmap;
  });
  vi.stubGlobal('createImageBitmap', decode);
  return { decode, close };
}

// The HTMLImageElement route; `natural` is what the engine reports.
export function elementDecoder(natural: { readonly width: number; readonly height: number }) {
  const createObjectURL = vi.fn(() => 'blob:photo');
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  class FakeImage {
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    public width = natural.width;
    public height = natural.height;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', FakeImage);
  return { createObjectURL };
}
