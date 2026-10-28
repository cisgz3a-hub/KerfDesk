// A masked photo centred on a captured board, and what each photo burns, for
// the Array on board mask tests (rolling audit v5 J9-P1-1, ADR-633 Amendment 3).

/* eslint-disable no-restricted-syntax -- These are scene artwork and operation colours in test fixtures, not UI chrome. */

import { compileJob } from '../../core/job';
import { runPreflight } from '../../core/preflight';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  transformedBBox,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { createEllipse } from '../../core/shapes/primitives';
import { lumaToBase64 } from '../raster/luma-bitmap';
import { useStore } from './store';

const PIXELS = 40;

function photo(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'photo',
    source: 'portrait.png',
    dataUrl: 'data:image/png;base64,portrait',
    pixelWidth: PIXELS,
    pixelHeight: PIXELS,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    transform: { ...IDENTITY_TRANSFORM, x: 180, y: 180 },
    color: '#808080',
    operationIds: ['photo-op'],
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: lumaToBase64(new Uint8Array(PIXELS * PIXELS).fill(40)),
  };
}

// A 40 mm circle over the photo, on a visible Line operation that does not output.
function circle(): SceneObject {
  return createEllipse({
    id: 'mask',
    color: '#000000',
    spec: { widthMm: 40, heightMm: 40 },
    transform: { ...IDENTITY_TRANSFORM, x: 180, y: 180 },
  });
}

/** A 200 × 100 mm board (X 100–300, Y 150–250) with the masked photo at its centre. */
export function setUpMaskedPhotoOnBoard(): void {
  useStore.getState().addCapturedBoardBox(200, 100);
  const { project } = useStore.getState();
  useStore.getState().setProject({
    ...project,
    scene: {
      ...project.scene,
      objects: [...project.scene.objects, photo(), circle()],
      layers: [
        ...project.scene.layers,
        { ...createLayer({ id: 'photo-op', color: '#808080', mode: 'image' }), linesPerMm: 1 },
        { ...createLayer({ id: 'mask-op', color: '#000000', mode: 'line' }), output: false },
      ],
    },
  });
  useStore.getState().applyImageMask('photo', 'mask');
}

export function maskedPhotos(): ReadonlyArray<RasterImage> {
  return useStore
    .getState()
    .project.scene.objects.filter(
      (object): object is RasterImage => object.kind === 'raster-image',
    );
}

/** Burned cells of each photo's raster group. */
export function burnedCellsPerPhoto(): ReadonlyArray<number> {
  const { project } = useStore.getState();
  const groups = compileJob(project.scene, project.device).groups;
  return maskedPhotos().map((object) => {
    const group = groups.find(
      (candidate) => candidate.kind === 'raster' && candidate.sourceObjectId === object.id,
    );
    const values = group?.kind === 'raster' ? group.sValues : [];
    return values.filter((s) => s > 0).length;
  });
}

/** Each photo's mask, which must lie exactly over that photo. */
export function masksOverTheirPhotos(): ReadonlyArray<boolean> {
  const { objects } = useStore.getState().project.scene;
  return maskedPhotos().map((image) => {
    const mask = objects.find((candidate) => candidate.id === image.imageMaskId);
    if (mask === undefined) return false;
    const a = transformedBBox(image);
    const b = transformedBBox(mask);
    return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
  });
}

export function offImageAdvisories(): ReadonlyArray<string> {
  const { project } = useStore.getState();
  return runPreflight(project, 'G1 X1 S1')
    .issues.filter((issue) => issue.code === 'image-mask-off-image')
    .map((issue) => issue.message);
}
