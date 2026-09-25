import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import { importImageFile } from '../commands/import-image-action';
import { parseSvgOffThread } from './document-import-worker-client';
import { pageArtworkObject } from './page-artwork-object';
import type { PreparedArtworkPage } from './paged-artwork-source';
import { ownedClipImage } from '../../__fixtures__/owned-image-clip';

vi.mock('../commands/import-image-action', () => ({ importImageFile: vi.fn() }));
vi.mock('./document-import-worker-client', () => ({ parseSvgOffThread: vi.fn() }));

const image: SceneObject = {
  kind: 'raster-image',
  id: 'page-image',
  source: 'encoded.png',
  dataUrl: 'data:image/png;base64,source',
  lumaBase64: 'sampled',
  pixelWidth: 4000,
  pixelHeight: 2000,
  bounds: { minX: 0, minY: 0, maxX: 400, maxY: 200 },
  transform: IDENTITY_TRANSFORM,
  color: '#000000',
  dither: 'floyd-steinberg',
  linesPerMm: 10,
};

function prepared(canvas: HTMLCanvasElement): PreparedArtworkPage {
  return {
    widthMm: 50.8,
    heightMm: 25.4,
    thumbnail: '',
    vectorSvg: '<svg width="50.8mm" height="25.4mm"><path d="M0 0L10 10"/></svg>',
    note: '',
    resolutionEditable: true,
    render: async () => canvas,
  };
}

describe('document page artwork preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseSvgOffThread).mockReturnValue(null);
    vi.mocked(importImageFile).mockImplementation(async (_file, commit) => {
      commit(image);
      return image;
    });
  });

  it('does not silently drop a bitmap when the editable-path destination receives mixed SVG', async () => {
    const page = {
      ...prepared(document.createElement('canvas')),
      vectorSvg:
        '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/><image width="10" height="10" preserveAspectRatio="none" href="' +
        ownedClipImage().dataUrl +
        '"/></svg>',
    };
    const commit = vi.fn();
    await expect(
      pageArtworkObject(page, 'mixed.pdf', 'paths', 300, {
        signal: new AbortController().signal,
        commit,
      }),
    ).rejects.toThrow(/contains embedded images/);
    expect(commit).not.toHaveBeenCalled();
  });

  it('asynchronously encodes PNG and keeps page millimetres with the existing sampled raster', async () => {
    const canvas = document.createElement('canvas');
    const encoded = new Blob(['png'], { type: 'image/png' });
    const encode = vi.spyOn(canvas, 'toBlob').mockImplementation((done) => done(encoded));
    const pixels = vi.spyOn(canvas, 'getContext');
    const dataUrl = vi.spyOn(canvas, 'toDataURL');
    const controller = new AbortController();
    const commit = vi.fn();

    await pageArtworkObject(prepared(canvas), 'art.pdf — page 2', 'image', 300, {
      signal: controller.signal,
      commit,
    });

    expect(encode).toHaveBeenCalledOnce();
    expect(pixels).not.toHaveBeenCalled();
    expect(dataUrl).not.toHaveBeenCalled();
    expect(importImageFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'art.pdf — page 2.png', type: 'image/png' }),
      expect.any(Function),
      expect.any(Function),
      { signal: controller.signal },
    );
    expect(commit).toHaveBeenCalledWith({
      ...image,
      source: 'art.pdf — page 2',
      bounds: { minX: 0, minY: 0, maxX: 50.8, maxY: 25.4 },
    });
  });

  it('cancels pending PNG encoding before any raster assets or scene object are created', async () => {
    const canvas = document.createElement('canvas');
    let complete: BlobCallback = () => undefined;
    vi.spyOn(canvas, 'toBlob').mockImplementation((done) => {
      complete = done;
    });
    const controller = new AbortController();
    const commit = vi.fn();
    const pending = pageArtworkObject(prepared(canvas), 'page', 'image', 300, {
      signal: controller.signal,
      commit,
    });
    await vi.waitFor(() => expect(canvas.toBlob).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    complete(new Blob(['png']));
    expect(importImageFile).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('never retries a started SVG worker failure on the UI thread', async () => {
    vi.mocked(parseSvgOffThread).mockRejectedValue(new Error('worker crashed'));
    const commit = vi.fn();
    await expect(
      pageArtworkObject(prepared(document.createElement('canvas')), 'page', 'paths', 300, {
        signal: new AbortController().signal,
        commit,
      }),
    ).rejects.toThrow('worker crashed');
    expect(commit).not.toHaveBeenCalled();
    expect(importImageFile).not.toHaveBeenCalled();
  });
});
