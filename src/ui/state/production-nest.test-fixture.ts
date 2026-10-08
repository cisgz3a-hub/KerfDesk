import { applied } from '../../core/material-library/process-recipe-template.test-fixture';
import { productionFixture } from '../../core/nesting/production-nest.test-fixture';
import {
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type RasterImage,
  type TextObject,
} from '../../core/scene';
import type { ProductionNestDefinition } from '../../core/nesting/production-nest';
import { fixtureState } from './variable-array-test-fixture';

export function productionProjectFixture(): Project {
  const project = applied();
  const source = project.scene.objects[0];
  if (source === undefined) throw new Error('Missing production artwork');
  const original = project.scene.objects[1] as ImportedSvg;
  const boundary = {
    ...original,
    paths: original.paths.map((path) => ({
      ...path,
      polylines: [
        ...path.polylines,
        {
          closed: true,
          points: [
            { x: 3, y: 3 },
            { x: 3, y: 7 },
            { x: 7, y: 7 },
            { x: 7, y: 3 },
          ],
        },
      ],
    })),
  };
  const { variableTemplate: _variable, ...plain } = fixtureState().project.scene
    .objects[0] as TextObject;
  const text: TextObject = {
    ...plain,
    id: 'linked-label',
    content: 'Panel',
    operationIds: project.scene.objects[0]?.operationIds ?? [],
    pathText: { guideObjectId: 'cutout', offsetMm: 0, reverse: false },
  };
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'photo',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,AA==',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 1, minY: 1, maxX: 2, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
    // eslint-disable-next-line no-restricted-syntax -- scene artwork data.
    color: '#000000',
    dither: 'threshold',
    linesPerMm: 5,
    imageMaskId: 'cutout',
  };
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: [source, boundary, text, image],
      groups: [
        { id: 'panel', name: 'Panel', objectIds: ['source', 'cutout', 'linked-label', 'photo'] },
      ],
    },
  };
}
export function productionDefinitionFixture(): ProductionNestDefinition {
  const base = productionFixture().definition;
  const part = base.parts[0];
  if (part === undefined) throw new Error('Missing production part');
  return {
    ...base,
    parts: [{ ...part, objectIds: ['source'], quantity: 2 }],
    sheets: base.sheets.map((sheet) => ({ ...sheet, widthMm: 14, heightMm: 14 })),
  };
}
