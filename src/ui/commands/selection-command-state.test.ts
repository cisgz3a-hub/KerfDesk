import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
} from '../../core/scene';
import { selectionCanBreakApart } from './selection-command-state';

describe('selection command state', () => {
  it('allows Break Apart for selected imported SVGs with one path and multiple contours', () => {
    const project = {
      ...createProject(),
      scene: {
        objects: [
          importedSvg('compound', compoundPath('#000000', [square(0, 0, 10), square(3, 3, 4)])),
        ],
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    };

    expect(selectionCanBreakApart(project, ['compound'])).toBe(true);
  });
});

function importedSvg(id: string, path: ColoredPath): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [path],
  };
}

function compoundPath(
  color: string,
  polylines: ReadonlyArray<ColoredPath['polylines'][number]>,
): ColoredPath {
  return { color, polylines };
}

function square(x: number, y: number, size: number): ColoredPath['polylines'][number] {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}
