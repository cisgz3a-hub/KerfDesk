import { beforeEach, describe, expect, it } from 'vitest';
import { transformedBBox } from '../../core/scene/hit-test';
import { createLayer } from '../../core/scene/layer';
import { createProject } from '../../core/scene/project';
import {
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type TextObject,
} from '../../core/scene/scene-object';
import { variableCopyOffset } from '../../core/variables';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const BOX: ImportedSvg = {
  kind: 'imported-svg',
  id: 'box',
  source: 'box.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: { ...IDENTITY_TRANSFORM, x: 200, y: 200 },
  operationIds: ['cut'],
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
            { x: 0, y: 0 },
          ],
        },
      ],
    },
  ],
};

const GUIDE: ImportedSvg = {
  ...BOX,
  id: 'guide',
  transform: IDENTITY_TRANSFORM,
  bounds: { minX: 0, minY: 50, maxX: 100, maxY: 50 },
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 50 },
            { x: 100, y: 50 },
          ],
        },
      ],
    },
  ],
};

const SERIAL: TextObject = {
  kind: 'text',
  id: 'serial',
  content: '{{serial:3}}',
  variableTemplate: { tokens: [{ kind: 'serial', prefix: '', width: 3 }] },
  fontKey: 'x',
  sizeMm: 5,
  alignment: 'left',
  lineHeight: 1,
  letterSpacing: 0,
  color: '#000000',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
  transform: { ...IDENTITY_TRANSFORM, x: 300, y: 300 },
  paths: [],
  operationIds: ['cut'],
};

function load(objects: ReadonlyArray<ImportedSvg | TextObject>, selected: ReadonlyArray<string>) {
  useStore.setState({
    project: {
      ...createProject(),
      scene: { objects, layers: [createLayer({ id: 'cut', color: '#000000' })], groups: [] },
    },
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
  });
}

beforeEach(resetStore);

const request = {
  mode: 'count' as const,
  count: 3,
  spacingMm: 0,
  startOffsetMm: 0,
  endOffsetMm: 0,
  rotateCopies: false,
  keepOriginal: true,
};

describe('Copy Along Path scale and variable increments', () => {
  it('grows the copies evenly to the end size, each centred on the guide', () => {
    load([BOX, GUIDE], ['box', 'guide']);
    expect(useStore.getState().copyAlongPath({ ...request, endScalePercent: 300 })).toBe(true);
    const copies = useStore.getState().project.scene.objects.slice(2);
    const widths = copies.map((copy) => {
      const box = transformedBBox(copy);
      return box.maxX - box.minX;
    });
    expect(widths.map((width) => Math.round(width * 1e6) / 1e6)).toEqual([10, 20, 30]);
    const last = transformedBBox(copies[2]!);
    expect((last.minX + last.maxX) / 2).toBeCloseTo(100, 9);
    expect((last.minY + last.maxY) / 2).toBeCloseTo(50, 9);
  });

  it('gives each copy the next serial after the kept original', () => {
    load([SERIAL, GUIDE], ['serial', 'guide']);
    useStore.getState().copyAlongPath({ ...request, incrementVariables: true });
    const copies = useStore.getState().project.scene.objects.slice(2);
    expect(copies.map((copy) => variableCopyOffset(copy))).toEqual([1, 2, 3]);
  });
});
