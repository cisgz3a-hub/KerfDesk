import { afterEach, expect, it, vi } from 'vitest';
import { loadImageAsRawData } from './image-loader';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function headerFile(width?: number, height?: number): File {
  const header = new Uint8Array(24);
  if (width !== undefined && height !== undefined) {
    header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const data = new DataView(header.buffer);
    data.setUint32(8, 13);
    data.setUint32(12, 0x49484452);
    data.setUint32(16, width);
    data.setUint32(20, height);
  }
  const file = new File([], 'source.png', { type: 'image/png' });
  Object.defineProperty(file, 'slice', {
    value: () => ({ arrayBuffer: async () => header.buffer }),
  });
  return file;
}

function objectUrls() {
  const create = vi.fn(() => 'blob:pending-image');
  const revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
  return { create, revoke };
}

it.each(['png', 'gif'])(
  'rejects a cancelled %s decode before starting any browser decoder',
  async (format) => {
    const controller = new AbortController();
    controller.abort();
    const createBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createBitmap);
    const urls = objectUrls();
    await expect(
      loadImageAsRawData(
        format === 'gif'
          ? new File([], 'source.gif', { type: 'image/gif' })
          : headerFile(4096, 2048),
        2048,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(createBitmap).not.toHaveBeenCalled();
    expect(urls.create).not.toHaveBeenCalled();
  },
);

it('cancels promptly during GIF preparation and still closes its late bitmap', async () => {
  const controller = new AbortController();
  const urls = objectUrls();
  let complete!: (bitmap: ImageBitmap) => void;
  const createBitmap = vi.fn(
    () =>
      new Promise<ImageBitmap>((resolve) => {
        complete = resolve;
      }),
  );
  vi.stubGlobal('createImageBitmap', createBitmap);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(new Blob([], { type: 'image/png' }));
  });
  let markClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    markClosed = resolve;
  });
  const close = vi.fn(markClosed);
  const decoding = loadImageAsRawData(
    new File([], 'source.gif', { type: 'image/gif' }),
    undefined,
    controller.signal,
  );
  const cancelled = expect(decoding).rejects.toMatchObject({ name: 'AbortError' });
  expect(createBitmap).toHaveBeenCalledOnce();
  controller.abort();
  await cancelled;
  complete({ close, width: 2, height: 2 } as unknown as ImageBitmap);
  await closed;
  expect(close).toHaveBeenCalledOnce();
  expect(createBitmap).toHaveBeenCalledOnce();
  expect(urls.create).not.toHaveBeenCalled();
});

it('clears an unfinished HTML image and revokes its object URL on cancellation', async () => {
  const controller = new AbortController();
  const urls = objectUrls();
  let created!: () => void;
  const started = new Promise<void>((resolve) => {
    created = resolve;
  });
  const images: PendingImage[] = [];
  class PendingImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = '';
    constructor() {
      images.push(this);
      created();
    }
  }
  vi.stubGlobal('Image', PendingImage);
  const decoding = loadImageAsRawData(headerFile(), undefined, controller.signal);
  const cancelled = expect(decoding).rejects.toMatchObject({ name: 'AbortError' });
  await started;
  const image = images[0]!;
  expect(image.src).toBe('blob:pending-image');
  controller.abort();
  await cancelled;
  expect(image.onload).toBeNull();
  expect(image.onerror).toBeNull();
  expect(image.src).toBe('');
  expect(urls.revoke).toHaveBeenCalledExactlyOnceWith('blob:pending-image');
});

it('closes a bitmap that arrives after cancellation without starting fallback decoding', async () => {
  const controller = new AbortController();
  const urls = objectUrls();
  let created!: () => void;
  const started = new Promise<void>((resolve) => {
    created = resolve;
  });
  let complete!: (bitmap: ImageBitmap) => void;
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => {
      created();
      return new Promise<ImageBitmap>((resolve) => {
        complete = resolve;
      });
    }),
  );
  const decoding = loadImageAsRawData(headerFile(4096, 2048), 2048, controller.signal);
  const cancelled = expect(decoding).rejects.toMatchObject({ name: 'AbortError' });
  await started;
  controller.abort();
  await cancelled;
  const close = vi.fn();
  complete({ close, width: 2048, height: 1024 } as unknown as ImageBitmap);
  await Promise.resolve();
  expect(close).toHaveBeenCalledOnce();
  expect(urls.create).not.toHaveBeenCalled();
});

it('aborts an unfinished FileReader header read before decoding', async () => {
  const controller = new AbortController();
  const urls = objectUrls();
  const readers: PendingReader[] = [];
  class PendingReader {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readonly readAsArrayBuffer = vi.fn();
    readonly abort = vi.fn();
    constructor() {
      readers.push(this);
    }
  }
  vi.stubGlobal('FileReader', PendingReader);
  const file = new File([], 'source.png', { type: 'image/png' });
  Object.defineProperty(file, 'slice', { value: () => ({}) });
  const decoding = loadImageAsRawData(file, undefined, controller.signal);
  const cancelled = expect(decoding).rejects.toMatchObject({ name: 'AbortError' });
  const reader = readers[0]!;
  expect(reader.readAsArrayBuffer).toHaveBeenCalledOnce();
  controller.abort();
  await cancelled;
  expect(reader.abort).toHaveBeenCalledOnce();
  expect(reader.onload).toBeNull();
  expect(reader.onerror).toBeNull();
  expect(urls.create).not.toHaveBeenCalled();
});
