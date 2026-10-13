import { describe, expect, it, vi } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  createProject,
  type ImportedSvg,
  type RasterImage,
} from '../../core/scene';
import { printableArtworkSvg, styledPrintSvg } from './print-artwork';
import { readRasterSourceFile } from '../import/paged-raster-source';

vi.mock('../import/paged-raster-source', () => ({ readRasterSourceFile: vi.fn() }));

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10mm"><path stroke="#ff0000" fill="none"/></svg>';

describe('print artwork', () => {
  it('sets the printed line width and forces black only when asked', () => {
    const colour = styledPrintSvg(SVG, { blackOnly: false, lineWidthMm: 0.3 });
    expect(colour).toContain(
      '<style>*{stroke-width:0.3px !important;vector-effect:none}</style><path',
    );
    expect(colour).not.toContain('stroke:#000');
    const black = styledPrintSvg(SVG, { blackOnly: true, lineWidthMm: 0.3 });
    expect(black).toContain('[stroke]:not([stroke="none"]){stroke:#000 !important}');
    expect(black).toContain('[fill]:not([fill="none"]){fill:#000 !important}');
  });

  it('prints only the selection and refuses an empty project', async () => {
    const line: ImportedSvg = {
      kind: 'imported-svg',
      id: 'a',
      source: 'a.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#ff0000',
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
              ],
            },
          ],
        },
      ],
    };
    const project = { ...createProject(), scene: { ...createProject().scene, objects: [line] } };
    const result = await printableArtworkSvg(
      project,
      ['a'],
      { blackOnly: true, lineWidthMm: 0.2 },
      new Date(0),
    );
    expect(result.ok && result.svg).toContain('stroke-width:0.2px');
    expect(
      await printableArtworkSvg(
        createProject(),
        [],
        { blackOnly: true, lineWidthMm: 0.2 },
        new Date(0),
      ),
    ).toEqual({
      ok: false,
      message: 'There is no artwork to print.',
    });
  });
});

it.each([false, true])(
  'prints original paged raster pixels even with thumbnail=%s',
  async (thumbnail) => {
    const image: RasterImage = {
      kind: 'raster-image',
      id: 'photo',
      source: 'photo.png',
      pixelWidth: 1,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      color: '#808080',
      dither: 'threshold',
      linesPerMm: 5,
      ...(thumbnail ? { dataUrl: 'data:image/bmp;base64,VEhVTUI=' } : {}),
      imageAsset: {
        schemaVersion: 1,
        repository: 'curvedesk-import-assets-v1',
        sourceAssetId: 'original',
        lumaAssetId: 'luma',
        sourceMimeType: 'image/png',
        sourceByteLength: 8,
        lumaByteLength: 1,
        naturalWidth: 1,
        naturalHeight: 1,
        sampledWidth: 1,
        sampledHeight: 1,
        thumbnail: {
          mimeType: 'image/bmp',
          dataUrl: 'data:image/bmp;base64,VEhVTUI=',
          width: 1,
          height: 1,
        },
      },
    };
    vi.mocked(readRasterSourceFile).mockResolvedValue(
      new File(['ORIGINAL'], 'photo.png', { type: 'image/png' }),
    );
    const project = createProject();
    const result = await printableArtworkSvg(
      { ...project, scene: { ...project.scene, objects: [image] } },
      [],
      { blackOnly: false, lineWidthMm: 0.2 },
      new Date(0),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.svg).toContain('data:image/png;base64,T1JJR0lOQUw=');
    expect(result.svg).not.toContain('VEhVTUI=');
    expect(readRasterSourceFile).toHaveBeenCalledWith(image, 'photo.png');
  },
);
