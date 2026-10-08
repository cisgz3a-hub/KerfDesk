import {
  createProject,
  DEFAULT_RASTER_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type RasterImage,
} from '../../core/scene';
import { prepareStampHeight } from '../../core/raster/stamp-height';
import { useStore } from './store';
import type { StampOwner } from './stamp-preparation-actions';
import type { PreparedStampSource } from '../raster/stamp-source';
import type { StampEncodedDraft } from '../raster/stamp-worker-protocol';
export function stampFixture() {
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'source',
    source: 'stamp.png',
    pixelWidth: 3,
    pixelHeight: 2,
    bounds: { minX: 1, minY: 2, maxX: 7, maxY: 4 },
    transform: { ...IDENTITY_TRANSFORM, x: 15, y: 30, scaleX: 2, scaleY: 3, rotationDeg: 37 },
    color: DEFAULT_RASTER_LAYER_COLOR,
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    dataUrl: 'data:image/png;base64,UE5H',
    lumaBase64: btoa(String.fromCharCode(0, 255, 255, 255, 255, 0)),
  };
  const project = {
    ...createProject(),
    scene: {
      objects: [image],
      layers: [],
      groups: [{ id: 'group', name: 'Original assembly', objectIds: ['source'] }],
    },
  };
  const owner: StampOwner = { project, documentEpoch: 24, ids: ['source'] };
  const source: PreparedStampSource = {
    image,
    pixels: {
      width: 3,
      height: 2,
      widthMm: 12,
      heightMm: 6,
      luma: new Uint8Array([0, 255, 255, 255, 255, 0]),
    },
  };
  const {
    face: _face,
    luma,
    ...dimensions
  } = prepareStampHeight(source.pixels, { threshold: 127, taperMm: 0.5, mirror: true });
  const draft: StampEncodedDraft = {
    ...dimensions,
    dataUrl: 'data:image/png;base64,UE5H',
    lumaBase64: btoa(String.fromCharCode(...luma)),
    sourceDataUrl: image.dataUrl ?? '',
    faceDataUrl: 'data:image/png;base64,ZmFjZQ==',
  };
  const state = {
    ...useStore.getState(),
    project,
    projectDocumentEpoch: 24,
    selectedObjectId: image.id,
    additionalSelectedIds: new Set<string>(),
    undoStack: [],
    redoStack: [],
    dirty: false,
  };
  return { state, image, project, owner, source, draft };
}
