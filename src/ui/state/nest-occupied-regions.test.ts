import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  transformedBBox,
  type ImportedSvg,
  type Polyline,
  type SceneObject,
  type TextObject,
} from '../../core/scene';
import type { QuickNestOptions } from './nest-actions';
import { useStore } from './store';

const COLOR = '#000000';
const OPTIONS = { bin: 'workspace', padding: 0, allowRotation: false, method: 'outline' } as const;
function nest(options: QuickNestOptions = OPTIONS) {
  return useStore.getState().quickNestSelection(options);
}

function rectangle(x: number, y: number, size: number, reverse = false): Polyline {
  const points = [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
  return { closed: true, points: reverse ? points.reverse() : points };
}

function artwork(id: string, polylines: ReadonlyArray<Polyline>, size = 40): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: size, maxY: size },
    paths: [{ color: COLOR, polylines }],
  };
}

function install(objects: ReadonlyArray<SceneObject>, group: ReadonlyArray<string> = []): void {
  useStore.setState({
    project: {
      ...createProject(),
      workspace: { width: 40, height: 40, units: 'mm' },
      scene: {
        objects,
        layers: [createLayer({ id: COLOR, color: COLOR })],
        groups: group.length === 0 ? [] : [{ id: 'group', name: 'Group', objectIds: group }],
      },
    },
    selectedObjectId: objects[0]?.id ?? null,
    additionalSelectedIds: new Set(objects.slice(1).map((object) => object.id)),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
}

describe('Quick Nest occupied regions', () => {
  it.each([false, true])(
    'does not cancel independent grouped solids (mirrored: %s)',
    (mirrored) => {
      const inner = artwork('inner', [rectangle(10, 10, 20, !mirrored)]);
      install(
        [
          artwork('outer', [rectangle(0, 0, 40)]),
          mirrored
            ? {
                ...inner,
                transform: { ...IDENTITY_TRANSFORM, x: 40, y: 40, scaleX: -1, rotationDeg: 90 },
              }
            : inner,
          artwork('insert', [rectangle(0, 0, 10)], 10),
        ],
        ['outer', 'inner'],
      );
      const before = useStore.getState().project;
      expect(nest().ok).toBe(false);
      expect(useStore.getState().project).toBe(before);
      expect(useStore.getState().undoStack).toEqual([]);
    },
  );

  it('preserves a same-winding even-odd hole with requested clearance', () => {
    install([
      artwork('ring', [rectangle(0, 0, 36), rectangle(8, 8, 20)], 36),
      artwork('insert', [rectangle(0, 0, 10)], 10),
    ]);
    expect(nest({ ...OPTIONS, padding: 2 })).toEqual({
      ok: true,
      packedUnits: 2,
    });
    const [ring, insert] = useStore.getState().project.scene.objects;
    expect(ring).toBeDefined();
    expect(insert).toBeDefined();
    if (ring === undefined || insert === undefined) return;
    const ringBounds = transformedBBox(ring);
    const insertBounds = transformedBBox(insert);
    expect(insertBounds.minX).toBeGreaterThanOrEqual(ringBounds.minX + 10);
    expect(insertBounds.minY).toBeGreaterThanOrEqual(ringBounds.minY + 10);
    expect(insertBounds.maxX).toBeLessThanOrEqual(ringBounds.minX + 26);
    expect(insertBounds.maxY).toBeLessThanOrEqual(ringBounds.minY + 26);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('unions separate fill batches instead of cancelling their overlap', () => {
    const object = artwork('batches', [rectangle(0, 0, 40)]);
    install([
      {
        ...object,
        paths: [...object.paths, { color: COLOR, polylines: [rectangle(10, 10, 20, true)] }],
      },
      artwork('insert', [rectangle(0, 0, 10)], 10),
    ]);
    expect(nest().ok).toBe(false);
  });

  it('retains nonzero text fill instead of treating nested same-winding contours as holes', () => {
    const text: TextObject = {
      ...artwork('text', [rectangle(0, 0, 40), rectangle(10, 10, 20)]),
      kind: 'text',
      content: 'O',
      fontKey: 'builtin:sans',
      sizeMm: 40,
      alignment: 'left',
      lineHeight: 1,
      letterSpacing: 0,
      color: COLOR,
    };
    install([text, artwork('insert', [rectangle(0, 0, 10)], 10)]);
    expect(nest().ok).toBe(false);
  });

  it('keeps the source-point budget even when normalization could simplify the outline', () => {
    const corners = rectangle(0, 0, 40).points;
    const dense = {
      closed: true,
      points: Array.from({ length: 20_004 }, (_, i) => corners[i % 4]!),
    };
    install([artwork('dense', [dense])]);
    expect(nest()).toEqual({ ok: true, packedUnits: 1, boundsFallbackUnits: 1 });
  });
});
