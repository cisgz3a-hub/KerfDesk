import { describe, expect, it, vi } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import { DEFAULT_TRACE_OPTIONS, type RawImageData } from '../../core/trace';
import {
  buildMultiFileTraceExports,
  runMultiFileTrace,
  type MultiFileTraceFile,
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

function rawImage(width: number, height: number): RawImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}

function namedFile(name: string): MultiFileTraceFile {
  return { name } as MultiFileTraceFile;
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
    expect(trace).toHaveBeenNthCalledWith(1, logo, DEFAULT_TRACE_OPTIONS);
    expect(trace).toHaveBeenNthCalledWith(2, photo, DEFAULT_TRACE_OPTIONS);
    expect(files.map((file) => file.filename)).toEqual(['logo-trace.svg', 'photo-trace.svg']);
    expect(files[0]?.svg).toContain('viewBox="0 0 4 3"');
    expect(files[1]?.svg).toContain('viewBox="0 0 6 5"');
  });
});

describe('runMultiFileTrace', () => {
  it('downloads one SVG per selected source image and reports success', async () => {
    const pushToast = vi.fn();
    const download = vi.fn();

    await runMultiFileTrace([namedFile('logo.png'), namedFile('logo.png')], pushToast, {
      loadImage: async () => rawImage(2, 2),
      trace: async () => [SQUARE_PATH],
      download,
    });

    expect(download).toHaveBeenCalledTimes(2);
    expect(download.mock.calls.map(([file]) => file.filename)).toEqual([
      'logo-trace.svg',
      'logo-2-trace.svg',
    ]);
    expect(pushToast).toHaveBeenCalledWith('Traced 2 images to SVG.', 'success');
  });

  it('keeps cancelled file picks silent', async () => {
    const pushToast = vi.fn();
    const download = vi.fn();
    const loadImage = vi.fn();

    await runMultiFileTrace([], pushToast, { loadImage, download });

    expect(loadImage).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('reports trace failures without downloading partial output', async () => {
    const pushToast = vi.fn();
    const download = vi.fn();

    await runMultiFileTrace([namedFile('broken.png')], pushToast, {
      loadImage: async () => {
        throw new Error('decode failed');
      },
      download,
    });

    expect(download).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith('Could not trace images: decode failed', 'error');
  });
});
