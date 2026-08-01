import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type OutputScope,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { createSession } from '../../ui/image-editor/editor-session';

const OBJECT_ID = 'kerf-context-image';
const COLOR = '#808080';
const SIZE_PX = 20;
const BOUNDS = { minX: 0, minY: 0, maxX: 20, maxY: 20 };

function image(): RasterImage {
  return {
    kind: 'raster-image',
    id: OBJECT_ID,
    source: 'source.png',
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: SIZE_PX,
    pixelHeight: SIZE_PX,
    bounds: BOUNDS,
    transform: IDENTITY_TRANSFORM,
    color: COLOR,
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: 'AAA=',
    imageMaskId: 'kerf-context-mask',
  };
}

function project(): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      objects: [image(), { ...image(), id: 'kerf-context-mask' }],
      layers: [
        {
          ...createLayer({ id: 'kerf-context-layer', color: COLOR, mode: 'image' }),
          dotWidthCorrectionMm: 1,
          linesPerMm: 1,
        },
      ],
    },
  };
}

function selectedScope(
  selectedObjectIds: ReadonlyArray<string>,
  useSelectionOrigin = false,
): OutputScope {
  return { cutSelectedGraphics: true, useSelectionOrigin, selectedObjectIds };
}

function session() {
  return createSession(OBJECT_ID, 'source.png', createRgbaBuffer(SIZE_PX, SIZE_PX), BOUNDS);
}

function withScene(
  sourceProject: Project,
  object: RasterImage,
  layers: ReadonlyArray<Layer>,
): Project {
  return {
    ...sourceProject,
    scene: {
      ...sourceProject.scene,
      objects: [
        object,
        ...sourceProject.scene.objects.filter((candidate) => candidate.id !== OBJECT_ID),
      ],
      layers,
    },
  };
}

/** Shared deterministic scene/session builders for kerf-context tests. */
export const kerfContextTestFixtures = {
  objectId: OBJECT_ID,
  sizePx: SIZE_PX,
  image,
  project,
  selectedScope,
  session,
  withScene,
};
