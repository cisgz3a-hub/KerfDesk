import { describe, expect, it, vi } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import { TRACE_PRESETS, type RawImageData } from '../../core/trace';
import {
  buildMultiFileTraceExports,
  runMultiFileTrace,
  type MultiFileTraceFile,
} from './multi-file-trace-action';
import { IMAGE_DENSITY_PROBE_BYTES } from '../common/image-density';
import { syntheticJpegFile } from '../trace/jpeg-header.test-support';
import { PREVIEW_MAX_EDGE_PX, scaleToCap } from '../trace/trace-decode-cap';
import { planTraceCommitGridFor } from '../trace/trace-commit-grid';

// Multi-File Trace sizes each export from the file's EMBEDDED density, read
// with the same parser Import Image uses, so a 300 DPI scan exports at its
// real size instead of the 254 DPI default. Only a bounded header prefix is
// read (readImageHeaderDensity), never the whole file.

const SQUARE_PATH: ColoredPath = {
  color: '#000000',
  polylines: [
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
      ],
    },
  ],
};

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function u16(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}
function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngChunk(type: string, data: number[]): number[] {
  return [...u32(data.length), ...ascii(type), ...data, 0, 0, 0, 0]; // dummy CRC
}

// pHYs in pixels per metre (unit 1): 11811 px/m = 300 DPI, 5906 px/m = 150 DPI.
// ancillaryBytes puts a zTXt chunk of that size ahead of pHYs, where a large
// metadata block would sit.
function pngBytes(
  phys?: { readonly x: number; readonly y: number },
  ancillaryBytes = 0,
): Uint8Array<ArrayBuffer> {
  const physChunk = phys === undefined ? [] : pngChunk('pHYs', [...u32(phys.x), ...u32(phys.y), 1]);
  const idat = pngChunk('IDAT', [0]);
  const bytes = new Uint8Array(
    PNG_SIG.length + ancillaryBytes + 12 + physChunk.length + idat.length,
  );
  let offset = 0;
  const put = (part: ArrayLike<number>): void => {
    bytes.set(part, offset);
    offset += part.length;
  };
  put(PNG_SIG);
  put([...u32(ancillaryBytes), ...ascii('zTXt')]);
  offset += ancillaryBytes;
  put([0, 0, 0, 0]);
  put(physChunk);
  put(idat);
  return bytes;
}

function jpegJfifBytes(xDpi: number, yDpi = xDpi): Uint8Array<ArrayBuffer> {
  const data = [...ascii('JFIF'), 0x00, 1, 2, 1, ...u16(xDpi), ...u16(yDpi), 0, 0];
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...u16(data.length + 2), ...data, 0xff, 0xd9]);
}

function imageFile(name: string, bytes: Uint8Array<ArrayBuffer>): MultiFileTraceFile {
  return new File([bytes], name);
}

function rawImage(width: number, height: number): RawImageData {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function svgSize(svg: string): {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly viewBox: readonly number[];
  readonly aspect: string | undefined;
} {
  const attr = (name: string) => new RegExp(`<svg[^>]*\\s${name}="([^"]*)"`).exec(svg)?.[1];
  return {
    widthMm: Number(attr('width')?.replace(/mm$/, '')),
    heightMm: Number(attr('height')?.replace(/mm$/, '')),
    viewBox: (attr('viewBox') ?? '').split(' ').map(Number),
    aspect: attr('preserveAspectRatio'),
  };
}

async function exportOne(
  file: MultiFileTraceFile,
  natural: { readonly width: number; readonly height: number },
  grid: { readonly width: number; readonly height: number } = natural,
): Promise<ReturnType<typeof svgSize> & { readonly densitySource: string | undefined }> {
  const files = await buildMultiFileTraceExports([file], {
    loadImage: async () => rawImage(grid.width, grid.height),
    readNaturalSize: async () => natural,
    trace: async () => [SQUARE_PATH],
    targetPxPerMm: 1,
    deviceMemoryGb: 8,
  });
  expect(files).toHaveLength(1);
  return { ...svgSize(files[0]!.svg), densitySource: files[0]!.densitySource };
}

describe('Multi-File Trace embedded density', () => {
  it('sizes a PNG with a 300 DPI pHYs chunk at 300 DPI, whatever grid was traced', async () => {
    const size = await exportOne(
      imageFile('scan.png', pngBytes({ x: 11811, y: 11811 })),
      { width: 1200, height: 600 },
      { width: 600, height: 300 },
    );

    // 1200 px / 300 DPI = 4 in = 101.6 mm; 600 px = 50.8 mm (not 120 x 60 mm).
    expect(size.widthMm).toBeCloseTo(101.6, 6);
    expect(size.heightMm).toBeCloseTo(50.8, 6);
    expect(size.viewBox).toEqual([0, 0, 600, 300]);
    // One viewBox unit is one traced cell: 101.6 / 600 mm on both axes.
    expect(size.widthMm / size.viewBox[2]!).toBeCloseTo(25.4 / 150, 9);
    expect(size.heightMm / size.viewBox[3]!).toBeCloseTo(25.4 / 150, 9);
  });

  it('sizes a JPEG with a 150 DPI JFIF density at 150 DPI', async () => {
    const size = await exportOne(imageFile('photo.jpg', jpegJfifBytes(150)), {
      width: 900,
      height: 450,
    });

    // 900 px / 150 DPI = 6 in = 152.4 mm; 450 px = 76.2 mm.
    expect(size.widthMm).toBeCloseTo(152.4, 6);
    expect(size.heightMm).toBeCloseTo(76.2, 6);
    expect(size.viewBox).toEqual([0, 0, 900, 450]);
    expect(size.widthMm / size.viewBox[2]!).toBeCloseTo(25.4 / 150, 9);
  });

  it('keeps the 254 DPI default for a file with no embedded density', async () => {
    const png = await exportOne(imageFile('plain.png', pngBytes()), { width: 1000, height: 500 });
    expect(png.widthMm).toBe(100);
    expect(png.heightMm).toBe(50);
    expect(png.densitySource).toBe('default');

    // An unreadable file (no bytes to parse) falls back the same way.
    const opaque = { name: 'opaque.png', size: 1 } as MultiFileTraceFile;
    const fallback = await exportOne(opaque, { width: 1000, height: 500 });
    expect(fallback.widthMm).toBe(100);
    expect(fallback.heightMm).toBe(50);
  });

  it('sizes each axis from its own density and stretches rather than letterboxes', async () => {
    // pHYs 300 DPI across, 150 DPI down: square pixels become 1:2 millimetres.
    const png = await exportOne(imageFile('aniso.png', pngBytes({ x: 11811, y: 5906 })), {
      width: 600,
      height: 600,
    });
    expect(png.widthMm).toBeCloseTo(50.8, 6);
    expect(png.heightMm).toBeCloseTo(101.6, 6);
    expect(png.viewBox).toEqual([0, 0, 600, 600]);
    expect(png.widthMm / png.viewBox[2]!).toBeCloseTo(25.4 / 300, 9);
    expect(png.heightMm / png.viewBox[3]!).toBeCloseTo(25.4 / 150, 9);
    // "meet" would draw the 600 x 600 grid as a 50.8 mm square inside a
    // 50.8 x 101.6 mm box; the stated size is only honoured with "none".
    expect(png.aspect).toBe('none');

    const jpeg = await exportOne(imageFile('aniso.jpg', jpegJfifBytes(200, 100)), {
      width: 400,
      height: 400,
    });
    expect(jpeg.widthMm).toBeCloseTo(50.8, 6);
    expect(jpeg.heightMm).toBeCloseTo(101.6, 6);
  });

  it('plans the working grid for the density-sized output, as a dialog commit does', async () => {
    const natural = { width: 6000, height: 4000 };
    const loadImage = vi.fn(async (_file: MultiFileTraceFile, maxEdge?: number) => {
      const grid = scaleToCap(natural.width, natural.height, maxEdge ?? PREVIEW_MAX_EDGE_PX);
      return rawImage(grid.width, grid.height);
    });
    const files = await buildMultiFileTraceExports(
      [imageFile('scan.png', pngBytes({ x: 23622, y: 23622 }))],
      {
        loadImage,
        readNaturalSize: async () => natural,
        trace: async () => [SQUARE_PATH],
        targetPxPerMm: 10,
        deviceMemoryGb: 64,
      },
    );

    // 23622 px/m = 600 DPI: 6000 px = 254 mm, not the default's 600 mm.
    const outputMm = { width: 254, height: (4000 / 600) * 25.4 };
    const plan = planTraceCommitGridFor(
      natural,
      { outputMm, targetPxPerMm: 10, deviceMemoryGb: 64 },
      TRACE_PRESETS['Line Art']!,
    );
    expect(plan).not.toBeNull();
    expect(loadImage).toHaveBeenCalledWith(expect.anything(), plan!.maxEdge);
    expect(svgSize(files[0]!.svg).widthMm).toBeCloseTo(254, 6);
  });

  it('applies the density when only a decoder is injected', async () => {
    const files = await buildMultiFileTraceExports(
      [imageFile('small.png', pngBytes({ x: 11811, y: 11811 }))],
      { loadImage: async () => rawImage(300, 150), trace: async () => [SQUARE_PATH] },
    );
    const size = svgSize(files[0]!.svg);
    expect(size.widthMm).toBeCloseTo(25.4, 6);
    expect(size.heightMm).toBeCloseTo(12.7, 6);
  });

  it('pairs an EXIF-rotated JPEG with its swapped JFIF densities', async () => {
    // Stored 600 x 200 at 200 DPI across, 100 DPI down; Orientation 6 turns
    // it upright to 200 x 600, so across is now 100 DPI and down 200 DPI.
    const file = syntheticJpegFile({
      width: 600,
      height: 200,
      jfifDpi: { x: 200, y: 100 },
      orientation: 6,
    });
    const size = await exportOne(file, { width: 200, height: 600 });

    // 200 px / 100 DPI = 50.8 mm; 600 px / 200 DPI = 76.2 mm. Unswapped
    // densities would give 25.4 x 152.4 mm.
    expect(size.widthMm).toBeCloseTo(50.8, 6);
    expect(size.heightMm).toBeCloseTo(76.2, 6);
    expect(size.densitySource).toBe('embedded');
  });

  it('reads density from a bounded header prefix, not the whole file', async () => {
    // A pHYs behind 512 KiB of metadata is still inside the prefix.
    const file = imageFile('meta.png', pngBytes({ x: 11811, y: 11811 }, 512 * 1024));
    const slice = vi.spyOn(file, 'slice');
    const arrayBuffer = vi.fn(async () => {
      throw new Error('the whole file must not be read');
    });
    Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer });

    const size = await exportOne(file, { width: 1200, height: 600 });

    expect(size.widthMm).toBeCloseTo(101.6, 6);
    expect(size.densitySource).toBe('embedded');
    expect(slice).toHaveBeenCalledWith(0, IMAGE_DENSITY_PROBE_BYTES);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('falls back to the default when pHYs lies beyond the header prefix', async () => {
    const bytes = pngBytes({ x: 11811, y: 11811 }, IMAGE_DENSITY_PROBE_BYTES);
    const size = await exportOne(imageFile('huge-meta.png', bytes), { width: 1000, height: 500 });
    expect(size.widthMm).toBe(100);
    expect(size.densitySource).toBe('default');
  });

  it('tells the operator which written files fell back to the default DPI', async () => {
    const run = async (files: ReadonlyArray<MultiFileTraceFile>) => {
      const pushToast = vi.fn();
      await runMultiFileTrace(files, pushToast, {
        loadImage: async () => rawImage(10, 10),
        trace: async () => [SQUARE_PATH],
        write: async () => true,
      });
      return pushToast;
    };
    const scan = () => imageFile('scan.png', pngBytes({ x: 11811, y: 11811 }));
    const plain = () => imageFile('plain.png', pngBytes());

    expect(await run([scan(), plain(), plain()])).toHaveBeenCalledWith(
      'Traced 3 images to SVG. 2 of 3 images had no embedded DPI and were sized at 254 DPI.',
      'success',
    );
    expect(await run([scan(), plain()])).toHaveBeenCalledWith(
      'Traced 2 images to SVG. 1 of 2 images had no embedded DPI and was sized at 254 DPI.',
      'success',
    );
    expect(await run([plain()])).toHaveBeenCalledWith(
      'Traced 1 image to SVG. It had no embedded DPI, so it was sized at 254 DPI.',
      'success',
    );
    expect(await run([scan()])).toHaveBeenCalledWith('Traced 1 image to SVG.', 'success');
  });
});
