/* eslint-disable no-restricted-syntax -- stable operation colours are required by these fixtures. */
import {
  createLayer,
  createProject,
  type Project,
  type RasterImage,
  type TextObject,
} from '../../core/scene';
import { shapeObject } from '../state/testing/scene-clipboard-fixtures';
import type { PagedRasterAssetReader } from '../import/paged-raster-hydration';

export function artworkProject(): Project {
  const blank = createProject();
  const mask = {
    ...shapeObject(),
    id: 'mask',
    operationIds: ['cut'],
    locked: true,
    transform: {
      ...shapeObject().transform,
      x: 17,
      y: 9,
      scaleX: 1.5,
      scaleY: 0.75,
      rotationDeg: 30,
    },
  };
  const text: TextObject = {
    kind: 'text',
    id: 'text',
    content: 'Editable logo',
    fontKey: 'embedded:logo',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1,
    letterSpacing: 0,
    color: '#123456',
    bounds: mask.bounds,
    transform: mask.transform,
    paths: mask.paths,
    operationIds: ['engrave'],
    pathText: { guideObjectId: 'mask', offsetMm: 1, reverse: false },
  };
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'image',
    source: 'logo.png',
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 10,
    bounds: mask.bounds,
    transform: mask.transform,
    dataUrl: 'data:image/png;base64,AQIDBA==',
    pixelWidth: 2,
    pixelHeight: 2,
    lumaBase64: 'AECA/w==',
    imageMaskId: 'mask',
    operationIds: ['image-op'],
  };
  return {
    ...blank,
    notes: 'Template setup notes',
    embeddedFonts: [{ key: 'embedded:logo', fileName: 'Logo.otf', dataBase64: 'T1RUTwAAAAA=' }],
    scene: {
      objects: [mask, text, image],
      groups: [{ id: 'logo-group', name: 'Logo jig', objectIds: ['text', 'image'] }],
      layers: [
        { ...createLayer({ id: 'cut', color: '#000000', mode: 'line' }), speed: 321, power: 22 },
        {
          ...createLayer({ id: 'engrave', color: '#123456', mode: 'fill' }),
          speed: 456,
          power: 33,
        },
        {
          ...createLayer({ id: 'image-op', color: '#808080', mode: 'image' }),
          speed: 678,
          power: 44,
        },
        { ...createLayer({ id: 'unused', color: '#ff0000', mode: 'line' }), speed: 789, power: 55 },
      ],
    },
  };
}

export function pagedProject(): Project {
  const project = artworkProject();
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((object) => {
        if (object.kind !== 'raster-image') return object;
        const { dataUrl: _source, lumaBase64: _luma, ...rest } = object;
        return {
          ...rest,
          imageAsset: {
            schemaVersion: 1,
            repository: 'curvedesk-import-assets-v1',
            sourceAssetId: 'source',
            lumaAssetId: 'luma',
            sourceMimeType: 'image/png',
            sourceByteLength: 4,
            lumaByteLength: 4,
            naturalWidth: 8,
            naturalHeight: 8,
            sampledWidth: 2,
            sampledHeight: 2,
            thumbnail: {
              mimeType: 'image/bmp',
              dataUrl: 'data:image/bmp;base64,Qk0=',
              width: 1,
              height: 1,
            },
          },
        };
      }),
    },
  };
}

export function assetReader(): PagedRasterAssetReader {
  return {
    readManifest: async (id) => ({
      schemaVersion: 1,
      assetId: id,
      sourceName: id,
      mimeType: id === 'source' ? 'image/png' : 'application/x-curvedesk-luma',
      byteLength: 4,
      writtenByteLength: 4,
      pageBytes: 2,
      pageCount: 2,
      createdAtEpochMs: 1,
      state: 'ready',
    }),
    readAssetChunks: async function* (id) {
      const bytes = id === 'source' ? [1, 2, 3, 4] : [0, 64, 128, 255];
      for (const byte of bytes) yield Uint8Array.of(byte);
    },
    acquireReadLease: async () => undefined,
    releaseReadLease: async () => undefined,
  };
}
