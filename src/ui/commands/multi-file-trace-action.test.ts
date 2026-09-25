import { describe, expect, it, vi } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import { TRACE_PRESETS, type RawImageData } from '../../core/trace';
import {
  buildMultiFileTraceExports,
  runMultiFileTrace,
  type MultiFileTraceFile,
  writeTraceFileWithPlatform,
} from './multi-file-trace-action';

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

const ZERO_AREA_PATH: ColoredPath = {
  color: '#000000',
  polylines: [
    {
      closed: true,
      points: [
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ],
    },
  ],
};

const BACKGROUND_PATH: ColoredPath = {
  color: '#ffffff',
  polylines: [
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
    },
  ],
};

function rawImage(width: number, height: number): RawImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}

function namedFile(name: string): MultiFileTraceFile {
  return { name, size: 1 } as MultiFileTraceFile;
}

describe('buildMultiFileTraceExports', () => {
  it('loads every picked image and traces it to a standalone SVG export', async () => {
    const logo = rawImage(4, 3);
    const photo = rawImage(6, 5);
    const loadImage = vi.fn(async (file: MultiFileTraceFile): Promise<RawImageData> => {
      return file.name === 'logo.png' ? logo : photo;
    });
    const trace = vi.fn(async () => [SQUARE_PATH]);

    const { files } = await buildMultiFileTraceExports(
      [namedFile('logo.png'), namedFile('photo.jpg')],
      { loadImage, trace },
    );

    expect(loadImage).toHaveBeenNthCalledWith(1, namedFile('logo.png'));
    expect(loadImage).toHaveBeenNthCalledWith(2, namedFile('photo.jpg'));
    expect(trace).toHaveBeenNthCalledWith(1, logo, TRACE_PRESETS['Line Art']);
    expect(trace).toHaveBeenNthCalledWith(2, photo, TRACE_PRESETS['Line Art']);
    expect(files.map((file) => file.filename)).toEqual(['logo-trace.svg', 'photo-trace.svg']);
    // The page is the image at its import size (default density), in mm.
    expect(files[0]?.text).toContain('viewBox="0 0 0.4 0.3"');
    expect(files[1]?.text).toContain('viewBox="0 0 0.6 0.5"');
  });

  // Rule 7 / ADR-228: this batch used to skip any file over 25 MB SILENTLY —
  // there is no toast channel here, so a declined file just vanished from the
  // output. Size is a policy judgement, so every selected file now traces.
  it('traces oversized files instead of skipping them', async () => {
    const oversized = new File(['x'], 'oversized.png');
    Object.defineProperty(oversized, 'size', { value: 30 * 1024 * 1024 });
    const small = new File(['x'], 'small.png');
    const loadImage = vi.fn(async () => rawImage(4, 3));
    const trace = vi.fn(async () => [SQUARE_PATH]);

    const { files } = await buildMultiFileTraceExports([oversized, small], { loadImage, trace });

    expect(loadImage).toHaveBeenCalledTimes(2);
    expect(files.map((file) => file.filename)).toEqual(['oversized-trace.svg', 'small-trace.svg']);
  });
});

describe('runMultiFileTrace', () => {
  it('retains actual fallback notices on exported files and reports them after saving', async () => {
    const data = new Uint8ClampedArray(16 * 16 * 4).fill(255);
    for (const y of [7, 8]) data.set([0, 0, 0, 255], (y * 16 + 7) * 4);
    const loadImage = async (): Promise<RawImageData> => ({ width: 16, height: 16, data });
    const preset = TRACE_PRESETS['Sharp'];
    if (preset === undefined) throw new Error('Missing Sharp preset');
    // Force removal of the two-pixel fixture; Sharp now preserves it by default.
    const options = { ...preset, despeckleMinPixels: 4 };
    const pushToast = vi.fn();
    const write = vi.fn(async () => true);
    await runMultiFileTrace([namedFile('speck.png')], pushToast, {
      loadImage,
      options,
      write,
    });
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'speck-trace.svg', notices: ['relaxed-settings'] }),
    );
    expect(pushToast).toHaveBeenCalledWith(
      expect.stringContaining('Automatic retry used relaxed trace settings'),
      'success',
    );
  });

  it('writes one SVG per selected source image and reports success', async () => {
    const pushToast = vi.fn();
    const writtenFiles: string[] = [];
    const write = vi.fn(async (file: { readonly filename: string }) => {
      writtenFiles.push(file.filename);
      return true;
    });

    await runMultiFileTrace([namedFile('logo.png'), namedFile('logo.png')], pushToast, {
      loadImage: async () => rawImage(2, 2),
      trace: async () => [SQUARE_PATH],
      write,
    });

    expect(write).toHaveBeenCalledTimes(2);
    expect(writtenFiles).toEqual(['logo-trace.svg', 'logo-2-trace.svg']);
    expect(pushToast).toHaveBeenCalledWith('Traced 2 images to SVG.', 'success');
  });

  it('exports physical SVG dimensions from the source image size, not the sampled trace grid', async () => {
    const { files } = await buildMultiFileTraceExports([namedFile('logo.png')], {
      loadImage: async () => rawImage(500, 250),
      readNaturalSize: async () => ({ width: 1000, height: 500 }),
      trace: async () => [SQUARE_PATH],
    });

    expect(files[0]?.text).toContain('viewBox="0 0 100 50"');
    expect(files[0]?.text).toContain('width="100mm"');
    expect(files[0]?.text).toContain('height="50mm"');
  });

  it('keeps cancelled file picks silent', async () => {
    const pushToast = vi.fn();
    const write = vi.fn();
    const loadImage = vi.fn();

    await runMultiFileTrace([], pushToast, { loadImage, write });

    expect(loadImage).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('keeps cancelled SVG saves silent when no trace export is written', async () => {
    const pushToast = vi.fn();
    const write = vi.fn(async () => false);

    await runMultiFileTrace([namedFile('logo.png')], pushToast, {
      loadImage: async () => rawImage(2, 2),
      trace: async () => [SQUARE_PATH],
      write,
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('reports trace failures without writing partial output', async () => {
    const pushToast = vi.fn();
    const write = vi.fn();

    await runMultiFileTrace([namedFile('broken.png')], pushToast, {
      loadImage: async () => {
        throw new Error('decode failed');
      },
      write,
    });

    expect(write).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith('Could not trace images: decode failed', 'error');
  });

  it.each([
    ['empty.png', []],
    ['empty-groups.png', [{ color: '#000000', polylines: [] }]],
    ['transparent.png', [ZERO_AREA_PATH]],
    ['blank.png', [BACKGROUND_PATH]],
  ] as const)('skips %s with a notice instead of writing a blank file', async (name, paths) => {
    const pushToast = vi.fn();
    const write = vi.fn();

    await runMultiFileTrace([namedFile(name)], pushToast, {
      loadImage: async () => rawImage(4, 4),
      trace: async () => [...paths],
      write,
    });

    expect(write).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      `Skipped 1 image with no visible paths (${name}); try Trace Image with an adjusted threshold or import as Image instead.`,
      'warning',
    );
  });

  it('writes the other images when one image in the batch is blank and reports the skip', async () => {
    const pushToast = vi.fn();
    const written: string[] = [];
    const write = vi.fn(async (file: { readonly filename: string }) => {
      written.push(file.filename);
      return true;
    });
    const trace = vi
      .fn()
      .mockResolvedValueOnce([SQUARE_PATH])
      .mockResolvedValueOnce([BACKGROUND_PATH])
      .mockResolvedValueOnce([SQUARE_PATH]);

    await runMultiFileTrace(
      [namedFile('logo.png'), namedFile('blank.png'), namedFile('badge.png')],
      pushToast,
      { loadImage: async () => rawImage(4, 4), trace, write },
    );

    expect(written).toEqual(['logo-trace.svg', 'badge-trace.svg']);
    expect(pushToast).toHaveBeenCalledWith(
      'Traced 2 images to SVG. Skipped 1 image with no visible paths (blank.png); try Trace Image with an adjusted threshold or import as Image instead.',
      'warning',
    );
  });

  it('uses the chosen preset and writes DXF files when asked', async () => {
    const pushToast = vi.fn();
    const write = vi.fn(async () => true);
    const trace = vi.fn(async () => [SQUARE_PATH]);
    const options = TRACE_PRESETS['Smooth'];

    await runMultiFileTrace([namedFile('logo.png')], pushToast, {
      loadImage: async () => rawImage(4, 4),
      trace,
      write,
      ...(options === undefined ? {} : { options }),
      output: { format: 'dxf' },
    });

    expect(trace).toHaveBeenCalledWith(rawImage(4, 4), options);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'logo-trace.dxf', format: 'dxf' }),
    );
    const file = (write.mock.calls[0] as unknown as [{ readonly text: string }])[0];
    expect(file.text).toContain('LWPOLYLINE');
    expect(pushToast).toHaveBeenCalledWith('Traced 1 image to DXF.', 'success');
  });
});

describe('writeTraceFileWithPlatform', () => {
  it.each([
    ['svg', 'logo-trace.svg', '.svg'],
    ['dxf', 'logo-trace.dxf', '.dxf'],
  ] as const)('saves traced %s output through PlatformAdapter', async (format, name, ext) => {
    const write = vi.fn();
    const pickFileForSave = vi.fn(async () => ({ displayName: name, write }));

    const saved = await writeTraceFileWithPlatform(
      {
        id: 'mock',
        pickFilesForOpen: async () => [],
        pickFileForSave,
        serial: { isSupported: () => false, requestPort: async () => null },
      },
      { filename: name, format, text: 'content', pathCount: 1, sourceIndex: 0 },
    );

    expect(saved).toBe(true);
    expect(pickFileForSave).toHaveBeenCalledWith({ suggestedName: name, extensions: [ext] });
    expect(write).toHaveBeenCalledWith('content');
  });
});
