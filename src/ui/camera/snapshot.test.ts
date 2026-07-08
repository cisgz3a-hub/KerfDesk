import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RgbaImage } from '../../core/camera';
import type { FrameCaptureIo } from './decode-jpeg';
import type { ActiveCameraSource } from './frame-source';
import { saveCameraSnapshot } from './snapshot';

const FRAME: RgbaImage = {
  data: new Uint8ClampedArray([0, 0, 0, 255]),
  width: 1,
  height: 1,
};

const SOURCE: ActiveCameraSource = {
  kind: 'machine-jpeg',
  frameUrl: 'http://127.0.0.1:51731/frame.jpg?url=cam',
  cameraUrl: 'http://192.168.10.1:8080/media/getCapturePhoto',
};

const io: FrameCaptureIo = {
  fetchBlob: async () => new Blob(['x']),
  decodeToRgba: async () => FRAME,
};

// jsdom has neither canvas 2D nor ImageData: stub the encode surface used by
// rgbaToPngDataUrl.
function stubCanvasEncode(): void {
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    putImageData: vi.fn(),
    // Only putImageData is touched by the encoder.
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,QUJD');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('saveCameraSnapshot', () => {
  it('captures, encodes, and writes a PNG through the save picker', async () => {
    stubCanvasEncode();
    const write = vi.fn(async (_data: string | Blob) => undefined);
    const pickFileForSave = vi.fn(async () => ({ displayName: 'snap.png', write }));
    const result = await saveCameraSnapshot(SOURCE, { pickFileForSave }, io);
    expect(result).toBe('saved');
    expect(pickFileForSave).toHaveBeenCalledWith({
      suggestedName: 'camera-snapshot.png',
      extensions: ['.png'],
    });
    const blob = write.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    if (blob instanceof Blob) expect(blob.type).toBe('image/png');
  });

  it('reports cancelled when the operator dismisses the picker', async () => {
    stubCanvasEncode();
    const result = await saveCameraSnapshot(SOURCE, { pickFileForSave: async () => null }, io);
    expect(result).toBe('cancelled');
  });

  it('reports capture and encode failures distinctly', async () => {
    const noFrame = await saveCameraSnapshot(
      SOURCE,
      { pickFileForSave: async () => null },
      { ...io, fetchBlob: async () => null },
    );
    expect(noFrame).toBe('capture-failed');

    // No canvas stub: jsdom's getContext yields no 2D context → encode fails.
    const noEncode = await saveCameraSnapshot(SOURCE, { pickFileForSave: async () => null }, io);
    expect(noEncode).toBe('encode-failed');
  });
});
