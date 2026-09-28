import { describe, expect, it, vi } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import type { BatchTraceFile, RawImageData } from '../../core/trace';
import {
  buildMultiFileTraceExports,
  runMultiFileTrace,
  type MultiFileTraceFile,
} from './multi-file-trace-action';
import type { MultiFileTraceSize } from './multi-file-trace-size';

// The Size row (rank 33) gives every file one DPI or one width; the embedded
// density is then not used, and the file does not count as a default-DPI file.

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

const NATURAL = { width: 1200, height: 600 };

function rawImage(width: number, height: number): RawImageData {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function svgSize(svg: string): { readonly widthMm: number; readonly heightMm: number } {
  const attr = (name: string) => new RegExp(`<svg[^>]*\\s${name}="([^"]*)"`).exec(svg)?.[1];
  return {
    widthMm: Number(attr('width')?.replace(/mm$/, '')),
    heightMm: Number(attr('height')?.replace(/mm$/, '')),
  };
}

async function exportSized(size?: MultiFileTraceSize) {
  const { files } = await buildMultiFileTraceExports([{ name: 'scan.png' } as MultiFileTraceFile], {
    loadImage: async () => rawImage(600, 300),
    readNaturalSize: async () => NATURAL,
    // 300 DPI embedded: 1200 px = 101.6 mm.
    readDensity: async () => ({ xDpi: 300, yDpi: 300 }),
    trace: async () => [SQUARE_PATH],
    targetPxPerMm: 1,
    deviceMemoryGb: 8,
    ...(size === undefined ? {} : { size }),
  });
  expect(files).toHaveLength(1);
  return { ...svgSize(files[0]!.text), densitySource: files[0]!.densitySource };
}

describe('Multi-File Trace size override (rank 33)', () => {
  it('keeps the embedded density when the size comes from the file', async () => {
    const size = await exportSized();
    expect(size.widthMm).toBeCloseTo(101.6, 6);
    expect(size.densitySource).toBe('embedded');
  });

  it('sizes every file at the chosen DPI instead of its embedded density', async () => {
    const size = await exportSized({ kind: 'dpi', dpi: 600 });
    // 1200 px / 600 DPI = 2 in = 50.8 mm; 600 px = 25.4 mm.
    expect(size.widthMm).toBeCloseTo(50.8, 6);
    expect(size.heightMm).toBeCloseTo(25.4, 6);
    expect(size.densitySource).toBe('override');
  });

  it('sizes every file at the chosen width with its own aspect ratio', async () => {
    const size = await exportSized({ kind: 'width', widthMm: 80 });
    expect(size.widthMm).toBeCloseTo(80, 6);
    expect(size.heightMm).toBeCloseTo(40, 6);
  });

  it('does not report an overridden file as sized at the default DPI', async () => {
    const pushToast = vi.fn();
    await runMultiFileTrace([{ name: 'plain.png' } as MultiFileTraceFile], pushToast, {
      loadImage: async () => rawImage(100, 50),
      readNaturalSize: async () => ({ width: 100, height: 50 }),
      readDensity: async () => null,
      trace: async () => [SQUARE_PATH],
      size: { kind: 'dpi', dpi: 254 },
      write: async (_file: BatchTraceFile) => true,
    });
    const [message] = pushToast.mock.calls[0] as [string, string];
    expect(message).not.toMatch(/default/i);
    expect(message).toContain('Traced 1 image to SVG');
  });
});
