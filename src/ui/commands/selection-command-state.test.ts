import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
} from '../../core/scene';
import {
  selectedConvertibleVectors,
  selectionCanBreakApart,
  selectionCanCombine,
  selectionCanWeld,
} from './selection-command-state';

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

  it('allows Weld for selected vectors with mixed output metadata', () => {
    const project = {
      ...createProject(),
      scene: {
        objects: [
          { ...importedSvg('low-power', squarePath('#000000', 0, 0, 10)), powerScale: 50 },
          { ...importedSvg('high-power', squarePath('#000000', 5, 0, 10)), powerScale: 80 },
        ],
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    };

    expect(selectionCanWeld(project, ['low-power', 'high-power'])).toBe(true);
  });

  it('uses canonical curve closedness for Weld and Boolean availability', () => {
    const canonicalOpen = importedSvg('canonical-open', canonicalPath(true, false));
    const canonicalClosed = importedSvg('canonical-closed', canonicalPath(false, true));
    const ordinaryClosed = importedSvg('ordinary-closed', squarePath('#000000', 20, 0, 10));
    const project = {
      ...createProject(),
      scene: {
        objects: [canonicalOpen, canonicalClosed, ordinaryClosed],
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    };

    expect(selectionCanWeld(project, ['canonical-open'])).toBe(false);
    expect(selectionCanCombine(project, ['canonical-open', 'ordinary-closed'])).toBe(false);
    expect(selectionCanWeld(project, ['canonical-closed'])).toBe(true);
    expect(selectionCanCombine(project, ['canonical-closed', 'ordinary-closed'])).toBe(true);
  });

  // ADR-029 amendment ii: Convert to Bitmap merges the whole selection into
  // one bitmap, so the gate is "every selected object is a convertible
  // vector" — not just the primary (which once silently converted alone).
  it('returns the convertible selection only when every member qualifies', () => {
    const project = {
      ...createProject(),
      scene: {
        objects: [
          importedSvg('vec-a', squarePath('#000000', 0, 0, 10)),
          importedSvg('vec-b', squarePath('#000000', 5, 0, 10)),
        ],
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    };

    expect(selectedConvertibleVectors(project, ['vec-a']).map((o) => o.id)).toEqual(['vec-a']);
    expect(selectedConvertibleVectors(project, ['vec-a', 'vec-b']).map((o) => o.id)).toEqual([
      'vec-a',
      'vec-b',
    ]);
    expect(selectedConvertibleVectors(project, [])).toEqual([]);
    // A selected id that is missing (or not a vector) disqualifies the whole
    // selection — converting an ambiguous subset would silently drop objects.
    expect(selectedConvertibleVectors(project, ['vec-a', 'missing'])).toEqual([]);
  });

  it('returns convertibles in scene order regardless of selection order', () => {
    const project = {
      ...createProject(),
      scene: {
        objects: [
          importedSvg('vec-a', squarePath('#000000', 0, 0, 10)),
          importedSvg('vec-b', squarePath('#000000', 5, 0, 10)),
        ],
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    };

    expect(selectedConvertibleVectors(project, ['vec-b', 'vec-a']).map((o) => o.id)).toEqual([
      'vec-a',
      'vec-b',
    ]);
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

function squarePath(color: string, x: number, y: number, size: number): ColoredPath {
  return compoundPath(color, [square(x, y, size)]);
}

function compoundPath(
  color: string,
  polylines: ReadonlyArray<ColoredPath['polylines'][number]>,
): ColoredPath {
  return { color, polylines };
}

function canonicalPath(compatibilityClosed: boolean, canonicalClosed: boolean): ColoredPath {
  return {
    color: '#000000',
    polylines: [{ ...square(0, 0, 10), closed: compatibilityClosed }],
    curves: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { kind: 'line', to: { x: 10, y: 0 } },
          { kind: 'line', to: { x: 10, y: 10 } },
          { kind: 'line', to: { x: 0, y: 10 } },
        ],
        closed: canonicalClosed,
      },
    ],
  };
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
