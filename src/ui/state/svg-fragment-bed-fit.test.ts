import { afterEach, beforeEach, expect, it } from 'vitest';
import { ownedClipImage } from '../../__fixtures__/owned-image-clip';
import { IDENTITY_TRANSFORM, transformedBBox, type ImportedSvg } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

function composition() {
  const vector: ImportedSvg = {
    kind: 'imported-svg',
    id: 'vector',
    source: 'composition.svg',
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 200, y: 100 },
            ],
          },
        ],
      },
    ],
  };
  const { svgImport: _owner, operationIds: _operations, ...image } = ownedClipImage();
  return {
    source: 'composition.svg',
    bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 100 },
    objects: [
      vector,
      {
        ...image,
        id: 'image',
        transform: { ...IDENTITY_TRANSFORM, x: 300, y: -500, scaleX: 50, scaleY: 25 },
      },
    ],
  };
}

function boxes() {
  return useStore.getState().project.scene.objects.map(transformedBBox);
}

function expectCompositionOwnership() {
  const { scene } = useStore.getState().project;
  const savedImage = scene.objects[1];
  expect(savedImage?.kind === 'raster-image' && savedImage.imageClip).toEqual(
    ownedClipImage().imageClip,
  );
  expect(scene.groups?.[0]?.objectIds).toEqual(['vector', 'image']);
}

beforeEach(resetStore);
afterEach(resetStore);

it('fits the complete SVG uniformly without changing clip coordinates or relative placement', () => {
  const fragment = composition();
  const outcome = useStore.getState().importSvgFragment(fragment);
  expect(outcome).toMatchObject({
    kind: 'added',
    bedFit: { widthMm: 1000, heightMm: 100 },
  });
  expect(outcome.kind === 'added' && outcome.bedFit?.scale).toBeCloseTo(0.36);
  const [vector, image] = boxes();
  expect(vector?.minX).toBeCloseTo(20);
  expect(vector?.maxX).toBeCloseTo(92);
  expect(image?.minX).toBeCloseTo(308);
  expect(image?.maxX).toBeCloseTo(380);
  expect(vector?.minY).toBeCloseTo(182);
  expect(image?.minY).toBeCloseTo(182);
  expectCompositionOwnership();
});

it('undoes the shared fit first and the whole composition second, then redoes both', () => {
  useStore.getState().importSvgFragment(composition());
  const fitted = useStore.getState().project;
  expect(useStore.getState().undoStack).toHaveLength(2);
  useStore.getState().undo();
  const [vector, image] = boxes();
  expect(vector?.minX).toBe(-300);
  expect(vector?.maxX).toBe(-100);
  expect(image?.minX).toBe(500);
  expect(image?.maxX).toBe(700);
  useStore.getState().undo();
  expect(useStore.getState().project.scene.objects).toHaveLength(0);
  useStore.getState().redo();
  useStore.getState().redo();
  expect(useStore.getState().project).toEqual(fitted);
});

it('keeps the batch stagger on every component of a fitted composition', () => {
  useStore.getState().importSvgFragment(composition(), 1);
  const [vector, image] = boxes();
  expect(vector?.minX).toBeCloseTo(30);
  expect(image?.maxX).toBeCloseTo(390);
  expect(vector?.minY).toBeCloseTo(192);
  expect(image?.minY).toBeCloseTo(192);
});
