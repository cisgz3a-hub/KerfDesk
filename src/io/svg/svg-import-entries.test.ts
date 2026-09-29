import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ColoredPath, type Vec2 } from '../../core/scene';
import { appendVectorEntry, createSvgEntryList } from './svg-import-entries';
import type { SvgImportEntry } from './svg-import-fragment';

const path = (color: string, ...points: Vec2[]): ColoredPath => ({
  color,
  polylines: [{ points, closed: false }],
  curves: [],
});

describe('appendVectorEntry', () => {
  it('groups consecutive elements of one mode and grows the bounds', () => {
    const list = createSvgEntryList({ id: 'svg', source: 'a.svg' });
    appendVectorEntry(list, path('#ff0000', { x: 0, y: 0 }, { x: 1, y: 1 }), false);
    appendVectorEntry(list, path('#0000ff', { x: -2, y: 3 }, { x: 5, y: 4 }), false);
    appendVectorEntry(list, path('#000000', { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }), true);
    appendVectorEntry(list, path('#ff0000', { x: 9, y: 9 }, { x: 10, y: 10 }), false);

    expect(list.entries).toEqual([
      {
        kind: 'imported-svg',
        id: 'svg-0',
        source: 'a.svg',
        bounds: { minX: -2, minY: 0, maxX: 5, maxY: 4 },
        transform: IDENTITY_TRANSFORM,
        operationOverride: { mode: 'line' },
        paths: [
          path('#ff0000', { x: 0, y: 0 }, { x: 1, y: 1 }),
          path('#0000ff', { x: -2, y: 3 }, { x: 5, y: 4 }),
        ],
      },
      {
        kind: 'imported-svg',
        id: 'svg-1',
        source: 'a.svg',
        bounds: { minX: 1, minY: 1, maxX: 2, maxY: 2 },
        transform: IDENTITY_TRANSFORM,
        operationOverride: { mode: 'fill' },
        // SVG fills close every subpath and default to nonzero winding.
        paths: [
          {
            color: '#000000',
            fillRule: 'nonzero',
            polylines: [
              {
                points: [
                  { x: 1, y: 1 },
                  { x: 2, y: 1 },
                  { x: 2, y: 2 },
                ],
                closed: true,
              },
            ],
            curves: [],
          },
        ],
      },
      expect.objectContaining({ id: 'svg-2', operationOverride: { mode: 'line' } }),
    ]);
  });

  it('starts a new entry after another entry, such as an image, breaks the run', () => {
    const list = createSvgEntryList({ id: 'svg', source: 'a.svg' });
    appendVectorEntry(list, path('#ff0000', { x: 0, y: 0 }, { x: 1, y: 1 }), false);
    list.entries.push({ kind: 'svg-image', id: 'svg-1' } as unknown as SvgImportEntry);
    appendVectorEntry(list, path('#ff0000', { x: 2, y: 2 }, { x: 3, y: 3 }), false);

    expect(list.entries.map((entry) => entry.id)).toEqual(['svg-0', 'svg-1', 'svg-2']);
    expect(list.entries[0]).toMatchObject({ bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } });
  });
});
