// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { psdDocument } from '../../__fixtures__/psd-document';
import { decodePsdComposite } from './decode-psd';
import { inspectPsdComposite, readPsdHeader } from './psd-structure';

describe('PSD stored composite import', () => {
  it.each([
    [
      'rgb-raw-300dpi',
      '8868ee34e23c3808e21cb360152a215b35bb07aeb2c76b0d998d01efc459a3f3',
      300,
      300,
    ],
    [
      'rgb-rle-anisotropic',
      '8868ee34e23c3808e21cb360152a215b35bb07aeb2c76b0d998d01efc459a3f3',
      300,
      150,
    ],
    ['grayscale-rle', '5c5d40e3ac13cc6ec6955c5f34b75bcf136b8e78d761f0cb782e2bea739e744e', 254, 254],
    ['two-layers', 'cf5f87902ade912d0bbbdb37901c7362ccea3a9114b3e05064e07277b2c33cfa', 300, 300],
  ] as const)(
    'matches independently generated %s pixels and physical density',
    async (name, hash, x, y) => {
      const bytes = readFileSync(new URL(`../../__fixtures__/psd/${name}.psd`, import.meta.url));
      const image = await decodePsdComposite(bytes);
      expect([image.width, image.height]).toEqual([300, 180]);
      expect(createHash('sha256').update(image.data).digest('hex')).toBe(hash);
      expect(image.dpi).toEqual({ x, y });
    },
  );

  it.each([false, true])(
    'preserves genuine merged transparency for raw/RLE=%s RGB and grayscale',
    async (rle) => {
      const rgb = await decodePsdComposite(psdDocument({ alpha: true, mergedAlpha: true, rle }));
      expect([...rgb.data]).toEqual([255, 255, 255, 0, 40, 90, 139, 128, 60, 110, 160, 255]);
      const gray = await decodePsdComposite(
        psdDocument({ gray: true, alpha: true, mergedAlpha: true, rle }),
      );
      expect([...gray.data]).toEqual([255, 255, 255, 0, 90, 90, 90, 128, 255, 255, 255, 255]);
    },
  );
  it.each([false, true])(
    'does not confuse auxiliary alpha selections with opacity (RLE=%s)',
    async (rle) => {
      const image = await decodePsdComposite(psdDocument({ alpha: true, rle }));
      expect([...image.data]).toEqual([20, 70, 120, 255, 40, 90, 140, 255, 60, 110, 160, 255]);
    },
  );
  it('preserves stored PPI across independent display units and reports embedded profiles', async () => {
    const image = await decodePsdComposite(
      psdDocument({ resolution: [100, 2, 300, 1], profile: true }),
    );
    expect(image.dpi).toEqual({ x: 100, y: 300 });
    expect(image.hasColorProfile).toBe(true);
  });
  it('keeps a 300-pixel 300-PPI image 25.4 mm wide when Photoshop displays PPCM', async () => {
    const bytes = readFileSync(
      new URL('../../__fixtures__/psd/rgb-raw-300dpi.psd', import.meta.url),
    );
    const resource = bytes.indexOf(Buffer.from([0x38, 0x42, 0x49, 0x4d, 0x03, 0xed, 0, 0]));
    expect(resource).toBeGreaterThan(0);
    // Empty Pascal name: resource data begins 12 bytes after the signature.
    bytes.writeUInt16BE(2, resource + 12 + 4);
    bytes.writeUInt16BE(2, resource + 12 + 12);
    const image = await decodePsdComposite(bytes);
    expect(image.dpi).toEqual({ x: 300, y: 300 });
    expect((image.width / (image.dpi?.x ?? 0)) * 25.4).toBe(25.4);
  });
  it('treats invalid resolution as absent', async () => {
    expect(
      (await decodePsdComposite(psdDocument({ resolution: [0, 1, 300, 1] }))).dpi,
    ).toBeUndefined();
  });
  it('refuses missing or explicitly invalid merged previews', async () => {
    await expect(decodePsdComposite(psdDocument({ hasMergedPreview: false }))).rejects.toThrow(
      /no real merged preview/,
    );
    const bytes = psdDocument();
    const offset = inspectPsdComposite(bytes).offset;
    await expect(decodePsdComposite(bytes.subarray(0, offset))).rejects.toThrow(
      /no stored composite/,
    );
  });
  it.each([
    [4, 2, /PSB/],
    [22, 16, /8-bit/],
    [24, 4, /RGB and grayscale/],
    [12, 0, /channel layout/],
  ] as const)(
    'refuses unsupported header at %s before decoder allocation',
    (offset, value, message) => {
      const bytes = psdDocument();
      new DataView(bytes.buffer).setUint16(offset, value);
      expect(() => readPsdHeader(bytes)).toThrow(message);
    },
  );
  it('rejects dimensions from just the header before any pixel allocation', () => {
    const bytes = psdDocument().slice(0, 26);
    new DataView(bytes.buffer).setUint32(18, 0xffffffff);
    expect(() => readPsdHeader(bytes)).toThrow(/limit|canvas/);
    new DataView(bytes.buffer).setUint32(18, 0);
    expect(() => readPsdHeader(bytes)).toThrow(/no pixels/);
  });
  it('rejects ZIP and truncated raw/RLE planes without silently padding pixels', async () => {
    const bytes = psdDocument();
    new DataView(bytes.buffer).setUint16(inspectPsdComposite(bytes).offset, 2);
    await expect(decodePsdComposite(bytes)).rejects.toThrow(/ZIP/);
    for (const rle of [false, true]) {
      const complete = psdDocument({ rle });
      await expect(decodePsdComposite(complete.subarray(0, complete.length - 1))).rejects.toThrow(
        /incomplete/,
      );
    }
  });
  it('rejects RLE rows whose declared payload does not yield exactly one row', async () => {
    const bytes = psdDocument({ rle: true });
    const offset = inspectPsdComposite(bytes).offset;
    bytes[offset + 2 + 6] = 6;
    await expect(decodePsdComposite(bytes)).rejects.toThrow(/RLE row/);
  });
});
