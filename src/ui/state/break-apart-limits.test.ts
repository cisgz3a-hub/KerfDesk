// Break Apart and the project's limits (ADR-307 amendment 1). A project past
// PROJECT_SCENE_LIMITS saves but cannot be opened again, so a Break Apart that
// would take it past one is refused with a notice and changes nothing, and a
// Break Apart that fits is made exactly as before.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type RasterImage,
  type SceneGroup,
} from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import {
  PROJECT_SCENE_LIMITS,
  validateSceneBudgets,
} from '../../io/project/project-scene-integrity-validator';
import { serializeProject } from '../../io/project/serialize-project';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import {
  BLACK,
  currentProject,
  expectUnchanged,
  lastToast,
  loadScene,
  OBJECT_LIMIT,
  pastTheLimit,
  rects,
} from './testing/scene-limit-fixtures';
import { useToastStore } from './toast-store';

const ASK = 'Break apart fewer objects, or delete some objects first.';

// One imported artwork of `shapes` separate strokes, as a stipple or a sheet
// of parts arrives from a file: Break Apart makes each its own object.
function artwork(id: string, shapes: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: shapes, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: BLACK,
        polylines: Array.from({ length: shapes }, (_, index) => ({
          closed: false,
          points: [
            { x: index, y: 0 },
            { x: index, y: 1 },
          ],
        })),
      },
    ],
  };
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Break Apart and the project limits', () => {
  it('refuses to make one artwork of 12,000 shapes into 12,000 objects', () => {
    const before = loadScene([artwork('stipple', 12_000)], ['stipple']);

    useStore.getState().breakApartSelection();

    expectUnchanged(before);
    expect(useStore.getState().selectedObjectId).toBe('stipple');
    expect(lastToast()).toEqual({
      message: pastTheLimit('objects', OBJECT_LIMIT, ASK),
      variant: 'warning',
    });
  });

  it('breaks apart everything that fits, to the last object, in one undo step', () => {
    // 9,989 other objects: 11 shapes make 10,000 objects, 12 make one too many.
    const full = loadScene([artwork('parts', 12), ...rects(OBJECT_LIMIT - 11)], ['parts']);
    useStore.getState().breakApartSelection();
    expectUnchanged(full);
    expect(lastToast()?.message).toBe(pastTheLimit('objects', OBJECT_LIMIT, ASK));

    useToastStore.setState({ toasts: [] });
    const before = loadScene([artwork('parts', 11), ...rects(OBJECT_LIMIT - 11)], ['parts']);
    useStore.getState().breakApartSelection();
    expect(currentProject().scene.objects).toHaveLength(OBJECT_LIMIT);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(useStore.getState().additionalSelectedIds.size).toBe(10);
    expect(lastToast()).toBeUndefined();
    expect(deserializeProject(serializeProject(currentProject())).kind).toBe('ok');
  });

  it('refuses a group whose members would pass their limit though the objects fit', () => {
    // The artwork's group takes all of its parts in its place: 12 shapes add
    // 11 members. The filler groups hold 49,950 members and the artwork's
    // group 40, so 12 shapes would make 50,001 and 11 make exactly 50,000.
    const filler = rects(1_000);
    const groups: SceneGroup[] = [
      ...Array.from({ length: 50 }, (_, index) => ({
        id: `filler-group-${index}`,
        name: `Filler ${index}`,
        objectIds: filler.slice(0, 999).map((object) => object.id),
      })),
      {
        id: 'with-artwork',
        name: 'With artwork',
        objectIds: ['parts', ...filler.slice(0, 39).map((object) => object.id)],
      },
    ];
    const before = loadScene([artwork('parts', 12), ...filler], ['parts'], groups);
    useStore.getState().breakApartSelection();
    expectUnchanged(before);
    expect(lastToast()?.message).toBe(
      pastTheLimit('group members', PROJECT_SCENE_LIMITS.groupMembers, ASK),
    );

    loadScene([artwork('parts', 11), ...filler], ['parts'], groups);
    useStore.getState().breakApartSelection();
    expect(currentProject().scene.objects).toHaveLength(1_011);
    expect(validateSceneBudgets(currentProject().scene)).toBeNull();
  });

  it('says nothing about masks it did not let go when it is refused', () => {
    // Breaking a mask apart lets go of the image's reference to it, with a
    // notice. A refused Break Apart lets go of nothing, so only the refusal shows.
    const image: RasterImage = {
      kind: 'raster-image',
      id: 'image',
      source: 'image.png',
      dataUrl: 'data:image/png;base64,AA==',
      pixelWidth: 1,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 },
      transform: IDENTITY_TRANSFORM,
      color: BLACK,
      dither: 'grayscale',
      linesPerMm: 1,
      lumaBase64: 'AA==',
      imageMaskId: 'mask',
    };
    const before = loadScene([image, artwork('mask', 12), ...rects(OBJECT_LIMIT - 12)], ['mask']);

    useStore.getState().breakApartSelection();

    expectUnchanged(before);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      pastTheLimit('objects', OBJECT_LIMIT, ASK),
    ]);
  });
});
