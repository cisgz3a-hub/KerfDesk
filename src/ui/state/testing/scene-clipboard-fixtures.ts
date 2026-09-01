/* eslint-disable no-restricted-syntax -- test fixture scene data needs stable operation colors. */

import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type Project,
  type RasterImage,
  type SceneObject,
  type ShapeObject,
  type TextObject,
  type TracedImage,
} from '../../../core/scene';
import { svgObj } from '../test-helpers';

const BLACK_PATH: ColoredPath = {
  color: '#000000',
  polylines: [
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 3 },
      ],
    },
  ],
};

export function textDependencyChain(): { readonly project: Project; readonly rootId: string } {
  const guide = { ...shapeObject(), id: 'guide-c' };
  const middle = dependentText('text-b', guide.id);
  const root = dependentText('text-a', middle.id);
  return { project: dependencyProject([guide, middle, root]), rootId: root.id };
}

export function rasterDependencyChain(): { readonly project: Project; readonly rootId: string } {
  const mask = { ...shapeObject(), id: 'mask-c' };
  const guide = {
    ...rasterObject(),
    id: 'raster-b',
    imageMaskId: mask.id,
    lumaBase64: Buffer.from([128, 128, 128, 128]).toString('base64'),
  };
  const root = dependentText('text-a', guide.id);
  return { project: dependencyProject([mask, guide, root]), rootId: root.id };
}

export function dependentText(id: string, guideObjectId: string): TextObject {
  return {
    ...textObject(),
    id,
    content: id,
    pathText: { guideObjectId, offsetMm: 0, reverse: false },
  };
}

export function dependencyProject(objects: ReadonlyArray<SceneObject>): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      ...project.scene,
      objects,
      layers: [
        createLayer({ id: '#000000', color: '#000000', mode: 'line' }),
        createLayer({ id: '#123456', color: '#123456', mode: 'line' }),
        createLayer({ id: '#808080', color: '#808080', mode: 'image' }),
      ],
    },
  };
}

export function allObjectDependenciesResolve(objects: ReadonlyArray<SceneObject>): boolean {
  const ids = new Set(objects.map((object) => object.id));
  return objects.every((object) => {
    if (object.kind === 'raster-image') {
      return object.imageMaskId === undefined || ids.has(object.imageMaskId);
    }
    if (object.kind === 'text') {
      return object.pathText === undefined || ids.has(object.pathText.guideObjectId);
    }
    return true;
  });
}

export function projectWithVariants(): Project {
  const objects: ReadonlyArray<SceneObject> = [
    { ...svgObj('svg-1', ['#ff0000']), transform: { ...IDENTITY_TRANSFORM, x: 0, y: 0 } },
    textObject(),
    tracedObject(),
    rasterObject(),
    shapeObject(),
  ];
  const project = createProject();
  return {
    ...project,
    scene: {
      objects,
      layers: [
        createLayer({ id: '#ff0000', color: '#ff0000', mode: 'line' }),
        createLayer({ id: '#123456', color: '#123456', mode: 'line' }),
        createLayer({ id: '#000000', color: '#000000', mode: 'fill' }),
        createLayer({ id: '#808080', color: '#808080', mode: 'image' }),
      ],
    },
  };
}

function textObject(): TextObject {
  return {
    kind: 'text',
    id: 'text-1',
    content: 'Text',
    fontKey: 'Roboto',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1,
    letterSpacing: 0,
    color: '#123456',
    bounds: { minX: 0, minY: 0, maxX: 8, maxY: 4 },
    transform: { ...IDENTITY_TRANSFORM, x: 1, y: 1 },
    paths: [{ ...BLACK_PATH, color: '#123456' }],
  };
}

function tracedObject(): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace-1',
    source: 'trace.png',
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    transform: { ...IDENTITY_TRANSFORM, x: 2, y: 2 },
    paths: [BLACK_PATH],
  };
}

function rasterObject(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'raster-1',
    source: 'raster.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    transform: { ...IDENTITY_TRANSFORM, x: 3, y: 3 },
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 10,
    lumaBase64: 'gA==',
  };
}

export function shapeObject(): ShapeObject {
  return {
    kind: 'shape',
    id: 'shape-1',
    spec: { kind: 'rect', widthMm: 5, heightMm: 5, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    transform: { ...IDENTITY_TRANSFORM, x: 4, y: 4 },
    paths: [BLACK_PATH],
  };
}
