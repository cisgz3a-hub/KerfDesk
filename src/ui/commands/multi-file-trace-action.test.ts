import { describe, expect, it, vi } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import { TRACE_PRESETS, type RawImageData } from '../../core/trace';
import {
  buildMultiFileTraceExports,
  runMultiFileTrace,
  type MultiFileTraceFile,
  writeTraceSvgFileWithPlatform,
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

    const files = await buildMultiFileTraceExports(
      [namedFile('logo.png'), namedFile('photo.jpg')],
      { loadImage, trace },
    );

    expect(loadImage).toHaveBeenNthCalledWith(1, namedFile('logo.png'));
    expect(loadImage).toHaveBeenNthCalledWith(2, namedFile('photo.jpg'));
    expect(trace).toHaveBeenNthCalledWith(1, logo, TRACE_PRESETS['Line Art']);
    expect(trace).toHaveBeenNthCalledWith(2, photo, TRACE_PRESETS['Line Art']);
    expect(files.map((file) => file.filename)).toEqual(['logo-trace.svg', 'photo-trace.svg']);
    expect(files[0]?.svg).toContain('viewBox="0 0 4 3"');
    expect(files[1]?.svg).toContain('viewBox="0 0 6 5"');
  });

  it('asks before decoding oversized files and skips declined ones', async () => {
    const oversized = new File(['x'], 'oversized.png');
    Object.defineProperty(oversized, 'size', { value: 30 * 1024 * 1024 });
    const small = new File(['x'], 'small.png');
    const loadImage = vi.fn(async () => rawImage(4, 3));
    const confirmOversizeImport = vi.fn((name: string) => name !== 'oversized.png');
    const trace = vi.fn(async () => [SQUARE_PATH]);

    const files = await buildMultiFileTraceExports([oversized, small], {
      loadImage,
      confirmOversizeImport,
      trace,
    });

    expect(confirmOversizeImport).toHaveBeenCalledWith('oversized.png', oversized.size);
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledWith(small);
    expect(files.map((file) => file.filename)).toEqual(['small-trace.svg']);
  });
});

describe('runMultiFileTrace', () => {
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
    const files = await buildMultiFileTraceExports([namedFile('logo.png')], {
      loadImage: async () => rawImage(500, 250),
      readNaturalSize: async () => ({ width: 1000, height: 500 }),
      trace: async () => [SQUARE_PATH],
    });

    expect(files[0]?.svg).toContain('viewBox="0 0 500 250"');
    expect(files[0]?.svg).toContain('width="100mm"');
    expect(files[0]?.svg).toContain('height="50mm"');
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

  it('does not write transparent SVGs when tracing produces no visible paths', async () => {
    const pushToast = vi.fn();
    const write = vi.fn();

    await runMultiFileTrace([namedFile('empty.png')], pushToast, {
      loadImage: async () => rawImage(2, 2),
      trace: async () => [],
      write,
    });

    expect(write).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      'Could not trace images: Trace produced no visible paths for empty-trace.svg. Try Trace Image with adjusted threshold or import as Image instead.',
      'error',
    );
  });

  it('does not write SVGs when trace returns only non-renderable path groups', async () => {
    const pushToast = vi.fn();
    const write = vi.fn();

    await runMultiFileTrace([namedFile('empty-groups.png')], pushToast, {
      loadImage: async () => rawImage(2, 2),
      trace: async () => [{ color: '#000000', polylines: [] }],
      write,
    });

    expect(write).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      'Could not trace images: Trace produced no visible paths for empty-groups-trace.svg. Try Trace Image with adjusted threshold or import as Image instead.',
      'error',
    );
  });

  it('does not write SVGs when trace returns only zero-area geometry', async () => {
    const pushToast = vi.fn();
    const write = vi.fn();

    await runMultiFileTrace([namedFile('transparent.png')], pushToast, {
      loadImage: async () => rawImage(4, 4),
      trace: async () => [ZERO_AREA_PATH],
      write,
    });

    expect(write).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      'Could not trace images: Trace produced no visible paths for transparent-trace.svg. Try Trace Image with adjusted threshold or import as Image instead.',
      'error',
    );
  });

  it('does not write blank-looking SVGs when trace returns only white background geometry', async () => {
    const pushToast = vi.fn();
    const write = vi.fn();

    await runMultiFileTrace([namedFile('blank.png')], pushToast, {
      loadImage: async () => rawImage(4, 4),
      trace: async () => [BACKGROUND_PATH],
      write,
    });

    expect(write).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      'Could not trace images: Trace produced no visible paths for blank-trace.svg. Try Trace Image with adjusted threshold or import as Image instead.',
      'error',
    );
  });
});

describe('writeTraceSvgFileWithPlatform', () => {
  it('saves traced SVG output through PlatformAdapter', async () => {
    const write = vi.fn();
    const pickFileForSave = vi.fn(async () => ({ displayName: 'logo-trace.svg', write }));

    const saved = await writeTraceSvgFileWithPlatform(
      {
        id: 'mock',
        pickFilesForOpen: async () => [],
        pickFileForSave,
        serial: { isSupported: () => false, requestPort: async () => null },
      },
      { filename: 'logo-trace.svg', svg: '<svg />', pathCount: 1 },
    );

    expect(saved).toBe(true);
    expect(pickFileForSave).toHaveBeenCalledWith({
      suggestedName: 'logo-trace.svg',
      extensions: ['.svg'],
    });
    expect(write).toHaveBeenCalledWith('<svg />');
  });
});
