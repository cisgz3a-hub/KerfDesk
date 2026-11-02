// Rolling audit v8 N3-P2-1 (ADR-494 Amendment 3): Weld, Subtract and Offset
// Shapes with Delete original objects build new outlines without the tabs
// placed by hand on their sources. ADR-156 lets them drop those tabs, and the
// new outline takes automatic tabs, but nothing said so; Extend names the same
// loss. They now say so too, and say nothing when no tab was lost.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import type { OffsetShapesRequest } from './offset-shapes-actions';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const COLOR = '#000000';

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('an edit that drops tabs placed by hand says so', () => {
  it('Weld', () => {
    const before = load([plate(true), box('feature', 35, 5)]);

    useStore.getState().weldSelection();

    expectNoPlacedTabs();
    expect(messages()).toContain(
      'Placed tabs on the welded shapes were removed. Undo restores them.',
    );
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });

  it('Subtract', () => {
    load([plate(true), box('hole', 15, 5)]);

    useStore.getState().booleanSelection('subtract');

    expectNoPlacedTabs();
    expect(messages()).toContain(
      'Placed tabs on the combined shapes were removed. Undo restores them.',
    );
  });

  it('Offset Shapes with Delete original objects', () => {
    load([plate(true)]);

    expect(useStore.getState().offsetShapesSelection(offset({ deleteOriginals: true }))).toBe(true);

    expectNoPlacedTabs();
    expect(messages()).toContain(
      'Placed tabs on the deleted originals were removed. Undo restores them.',
    );
  });

  // Rolling audit v9 R3-P2-1: Dogbone rebuilt the outline without them, silently.
  it('Dogbone', () => {
    const before = load([plate(true)]);

    useStore.getState().dogboneSelection(6);

    expectReliefsWithoutTabs('plate');
    expect(messages()).toEqual([
      'Placed tabs on the relieved shapes were removed. Undo restores them.',
    ]);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    useStore.getState().redo();
    expectReliefsWithoutTabs('plate');
  });

  it('Dogbone on a selection names them once, when any part held one', () => {
    load([plate(true), box('other', 100, 0, 40)]);

    useStore.getState().dogboneSelection(6);

    expectReliefsWithoutTabs('plate');
    expectReliefsWithoutTabs('other');
    expect(messages()).toEqual([
      'Placed tabs on the relieved shapes were removed. Undo restores them.',
    ]);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
});

describe('an edit that keeps them, or had none, says nothing about tabs', () => {
  it('keeps the originals', () => {
    load([plate(true), box('feature', 35, 5)]);
    useStore.getState().weldSelection({ keepOperands: true });
    useStore.getState().offsetShapesSelection(offset({ deleteOriginals: false }));
    expect(messages().filter((message) => message.includes('Placed tabs'))).toEqual([]);
  });

  it('had no placed tabs', () => {
    load([plate(false), box('feature', 35, 5)]);
    useStore.getState().weldSelection();
    expect(messages().filter((message) => message.includes('Placed tabs'))).toEqual([]);
  });

  it('Dogbone on a part with no placed tabs', () => {
    load([plate(false)]);
    useStore.getState().dogboneSelection(6);
    expectReliefsWithoutTabs('plate');
    expect(messages()).toEqual([]);
  });

  it('Dogbone that relieves nothing keeps the tabs and says nothing', () => {
    // An open contour has no corner to relieve, so the part stays as it was.
    const open: ImportedSvg = {
      ...plate(true),
      paths: [
        {
          color: COLOR,
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 40, y: 0 },
              ],
            },
          ],
        },
      ],
    };
    const before = load([open]);
    useStore.getState().dogboneSelection(6);
    expect(useStore.getState().project).toBe(before);
    expect(messages()).toEqual([]);
  });
});

function offset(patch: Partial<OffsetShapesRequest>): OffsetShapesRequest {
  return {
    distanceMm: 0.1,
    direction: 'outward',
    cornerStyle: 'corner',
    outerShapesOnly: false,
    deleteOriginals: false,
    ...patch,
  };
}

function box(id: string, x: number, y: number, size = 10): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: y, maxX: x + size, maxY: y + size },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [
      {
        color: COLOR,
        polylines: [
          {
            closed: true,
            points: [
              { x, y },
              { x: x + size, y },
              { x: x + size, y: y + size },
              { x, y: y + size },
            ],
          },
        ],
      },
    ],
  };
}

// A 40 × 20 plate, with one laser and one CNC tab placed by hand when `tabbed`.
function plate(tabbed: boolean): ImportedSvg {
  const outline = box('plate', 0, 0, 40);
  const tab = { layerColor: COLOR, pathIndex: 0, polylineIndex: 0, pathT: 0.1 };
  return {
    ...outline,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
    paths: [
      {
        color: COLOR,
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 40, y: 0 },
              { x: 40, y: 20 },
              { x: 0, y: 20 },
            ],
          },
        ],
      },
    ],
    ...(tabbed ? { laserTabAnchors: [tab], cncTabAnchors: [tab] } : {}),
  };
}

// Selects every object, the plate first (Subtract's subject is the bottom one).
function load(objects: ReadonlyArray<ImportedSvg>): Project {
  const layer = {
    ...createLayer({ id: 'cut', name: 'cut', color: COLOR }),
    mode: 'line' as const,
    tabsEnabled: true,
    tabSizeMm: 2,
    tabsPerShape: 4,
  };
  const project = {
    ...createProject(),
    scene: { objects: [...objects], layers: [layer], groups: [] },
  };
  useStore.setState({
    project,
    selectedObjectId: objects[0]?.id ?? null,
    additionalSelectedIds: new Set(objects.slice(1).map((object) => object.id)),
    dirty: false,
  });
  return project;
}

function messages(): ReadonlyArray<string> {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

function expectReliefsWithoutTabs(id: string): void {
  const object = useStore.getState().project.scene.objects.find((item) => item.id === id);
  if (object === undefined || !('paths' in object)) throw new Error('the part is gone');
  expect(object.paths[0]?.polylines[0]?.points.length).toBeGreaterThan(5);
  expect(object.laserTabAnchors).toBeUndefined();
  expect(object.cncTabAnchors).toBeUndefined();
}

function expectNoPlacedTabs(): void {
  const objects = useStore.getState().project.scene.objects;
  expect(objects.map((object) => object.id)).not.toContain('plate');
  for (const object of objects) {
    expect(object.laserTabAnchors ?? []).toEqual([]);
    expect(object.cncTabAnchors ?? []).toEqual([]);
  }
}
