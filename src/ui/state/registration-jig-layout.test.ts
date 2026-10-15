import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  findRegistrationBoxes,
  isRegistrationBox,
  transformedBBox,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import {
  registrationJigArtworkInstances,
  registrationJigObjectIdentity,
} from '../../core/scene/registration-jig-artwork';
import { compileJob } from '../../core/job/compile-job';
import { deserializeProject, serializeProject } from '../../io/project';
import { testAuthoringRelief } from '../../__fixtures__/relief-authoring';
import { createReliefAuthoringDocument } from '../../core/relief/relief-authoring-document';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { registrationJigSetIssue } from './registration-jig-set-actions';

const GRID = {
  outline: { kind: 'rectangle', widthMm: 40, heightMm: 30 },
  rows: 1,
  columns: 3,
  spacingX: 10,
  spacingY: 0,
} as const;

beforeEach(() => {
  resetStore();
  useStore.getState().replaceRegistrationJigSet(GRID);
  useStore.getState().drawShape(
    createRectangle({
      id: 'art',
      color: '#0000ff',
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
    }),
  );
  useStore.getState().centerSelectionInRegistrationBox();
  useStore.getState().setRegistrationOutput('artwork');
});

function scene() {
  return useStore.getState().project.scene;
}
function art() {
  return scene().objects.filter((object) => !isRegistrationBox(object));
}
function center(box: ReturnType<typeof transformedBBox>) {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}
function reopen() {
  const loaded = deserializeProject(serializeProject(useStore.getState().project));
  expect(loaded.kind).toBe('ok');
  if (loaded.kind !== 'ok') throw new Error('Could not reopen jig project');
  useStore.setState({ project: loaded.project });
}
function outputIds() {
  return new Set(
    compileJob(scene(), useStore.getState().project.device).groups.map(
      (group) => group.sourceObjectId,
    ),
  );
}

describe('fixture grid edits preserve linked artwork placement', () => {
  it.each([false, true])(
    'moves first and generated slots without changing size or offset (legacy=%s)',
    (legacy) => {
      useStore.setState((state) => ({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            objects: state.project.scene.objects.map((object) => {
              if (isRegistrationBox(object)) return object;
              const { registrationJig: _registrationJig, ...plain } = object;
              return {
                ...(legacy ? plain : object),
                locked: true,
                transform: {
                  ...object.transform,
                  x: object.transform.x + 3,
                  y: object.transform.y - 2,
                  rotationDeg: 15,
                },
              };
            }),
          },
        },
      }));
      const before = art();
      const oldBoxes = findRegistrationBoxes(scene());
      const previousProject = useStore.getState().project;
      const undoCount = useStore.getState().undoStack.length;
      useStore.getState().replaceRegistrationJigSet({
        ...GRID,
        outline: { kind: 'rectangle', widthMm: 60, heightMm: 50 },
        spacingX: 20,
      });
      const nextBoxes = findRegistrationBoxes(scene());
      art().forEach((object, index) => {
        const oldCenter = center(transformedBBox(oldBoxes[index]!));
        const nextCenter = center(transformedBBox(nextBoxes[index]!));
        expect(object.transform).toEqual({
          ...before[index]!.transform,
          x: before[index]!.transform.x + nextCenter.x - oldCenter.x,
          y: before[index]!.transform.y + nextCenter.y - oldCenter.y,
        });
        expect(object.locked).toBe(true);
      });
      expect(outputIds()).toEqual(new Set(before.map((object) => object.id)));
      expect(useStore.getState().undoStack).toHaveLength(undoCount + 1);
      useStore.getState().undo();
      expect(useStore.getState().project).toEqual(previousProject);
    },
  );

  it('keeps removed-slot artwork in place and output, detached from later source updates and save/reopen', () => {
    const retained = art()[2]!;
    useStore.getState().replaceRegistrationJigSet({ ...GRID, columns: 2 });
    expect(art().find((object) => object.id === retained.id)?.transform).toEqual(
      retained.transform,
    );
    expect(
      registrationJigArtworkInstances(scene()).flatMap((slot) =>
        slot.objects.map((object) => object.id),
      ),
    ).not.toContain(retained.id);
    expect(outputIds()).toContain(retained.id);
    expect(
      registrationJigObjectIdentity(art().find((object) => object.id === retained.id)!)?.ancestors,
    ).toEqual([]);
    reopen();
    useStore.setState({ selectedObjectId: 'art', additionalSelectedIds: new Set() });
    useStore.getState().centerSelectionInRegistrationBox();
    expect(art().find((object) => object.id === retained.id)?.transform).toEqual(
      retained.transform,
    );
    expect(outputIds()).toContain(retained.id);
  });

  it('removes artwork only when selected, cleans run order and groups, and restores it with Undo', () => {
    const removed = art()
      .slice(1)
      .map((object) => object.id);
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: { ...scene(), groups: [{ id: 'copies', name: 'Copies', objectIds: removed }] },
      },
    }));
    const before = useStore.getState().project;
    useStore
      .getState()
      .replaceRegistrationJigSet({ ...GRID, columns: 1, removedArtwork: 'remove' });
    expect(art().map((object) => object.id)).toEqual(['art']);
    expect(outputIds()).toEqual(new Set(['art']));
    expect(scene().artworkOrder).not.toEqual(expect.arrayContaining(removed));
    expect(scene().groups).toEqual([]);
    reopen();
    useStore.getState().undo();
    expect(useStore.getState().project).toEqual(before);
  });

  it('continues moving a single explicit member after shrinking the fixture', () => {
    useStore
      .getState()
      .replaceRegistrationJigSet({ ...GRID, columns: 1, removedArtwork: 'remove' });
    const before = art()[0]!;
    useStore.getState().replaceRegistrationJigSet({
      ...GRID,
      columns: 1,
      outline: { kind: 'circle', diameterMm: 60 },
    });
    expect(art()[0]!.transform).toEqual({
      ...before.transform,
      x: before.transform.x + 10,
      y: before.transform.y + 15,
    });
  });

  it('preserves external relief links and refuses requested deletion of their source', () => {
    const source = art()[2]!;
    const relief = testAuthoringRelief();
    const document = createReliefAuthoringDocument(relief.reliefSource);
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...scene(),
          objects: [
            ...scene().objects,
            {
              ...relief,
              reliefAuthoring: { ...document, clip: { rings: [], linkedObjectId: source.id } },
            },
          ],
        },
      },
    }));
    const requested = { ...GRID, columns: 2, removedArtwork: 'remove' as const };
    expect(registrationJigSetIssue(requested, scene())).toContain('retained relief');
    const before = useStore.getState().project;
    expect(() => useStore.getState().replaceRegistrationJigSet(requested)).toThrow(
      'retained relief',
    );
    expect(useStore.getState().project).toBe(before);
    useStore.getState().replaceRegistrationJigSet({ ...requested, removedArtwork: 'keep' });
    expect(scene().objects.some((object) => object.id === source.id)).toBe(true);
    expect(scene().objects.find((object) => object.id === source.id)?.transform).toEqual(
      source.transform,
    );
    expect(scene().objects.find((object) => object.id === relief.id)).toMatchObject({
      reliefAuthoring: { clip: { linkedObjectId: source.id } },
    });
  });
});

describe('retired jig lifecycle', () => {
  it.each(['jig', 'captured'] as const)(
    'does not reattach removed single-slot artwork to a new %s',
    (replacement) => {
      useStore
        .getState()
        .replaceRegistrationJigSet({ ...GRID, columns: 1, removedArtwork: 'remove' });
      const before = useStore.getState().project;
      const undoCount = useStore.getState().undoStack.length;
      const original = art()[0]!;
      useStore.getState().removeRegistrationBox();
      expect(useStore.getState().undoStack).toHaveLength(undoCount + 1);
      expect(art()[0]!.id).toBe(original.id);
      expect(art()[0]!.transform).toEqual(original.transform);
      reopen();
      if (replacement === 'jig')
        useStore.getState().replaceRegistrationJigSet({ ...GRID, columns: 1 });
      else useStore.getState().addCapturedBoardBox(100, 80);
      expect(registrationJigArtworkInstances(scene())).toEqual([]);
      expect(outputIds()).toContain(original.id);
      useStore.getState().undo();
      useStore.getState().undo();
      expect(useStore.getState().project).toEqual(before);
    },
  );

  it('detaches legacy encoded copy identities when removing the fixture', () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...scene(),
          objects: scene().objects.map((object) => {
            const { registrationJig: _identity, ...legacy } = object;
            return legacy;
          }),
        },
      },
    }));
    const ids = art().map((object) => object.id);
    const outputGeometry = () =>
      compileJob(scene(), useStore.getState().project.device)
        .groups.flatMap((group) =>
          group.kind === 'cut'
            ? group.segments.map((segment) => JSON.stringify(segment.polyline))
            : [],
        )
        .sort();
    const beforeOutput = outputGeometry();
    useStore.getState().removeRegistrationBox();
    useStore.getState().replaceRegistrationJigSet({ ...GRID, columns: 1 });
    expect(registrationJigArtworkInstances(scene())).toEqual([]);
    expect(art().map((object) => object.id)).toEqual(ids);
    expect(
      art().every((object) => registrationJigObjectIdentity(object)?.ancestors.length === 0),
    ).toBe(true);
    expect(outputGeometry()).toEqual(beforeOutput);
  });

  it('keeps retired copied groups through a later source Auto-fit and save/reopen', () => {
    useStore.getState().drawShape(
      createRectangle({
        id: 'art-right',
        color: '#0000ff',
        spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
      }),
    );
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...scene(),
          groups: [{ id: 'source-group', name: 'Source', objectIds: ['art', 'art-right'] }],
        },
      },
      selectedObjectId: 'art',
      additionalSelectedIds: new Set(['art-right']),
    }));
    useStore.getState().centerSelectionInRegistrationBox();
    const retiredId = registrationJigArtworkInstances(scene())[2]!.objects[0]!.id;
    const retiredGroup = scene().groups!.find((group) => group.objectIds.includes(retiredId))!;
    expect(retiredGroup).toBeDefined();
    useStore.getState().replaceRegistrationJigSet({ ...GRID, columns: 2, removedArtwork: 'keep' });
    reopen();
    const beforeRefit = useStore.getState().project;
    useStore.setState({ selectedObjectId: 'art', additionalSelectedIds: new Set(['art-right']) });
    useStore.getState().centerSelectionInRegistrationBox();
    expect(scene().groups).toContainEqual(retiredGroup);
    expect(outputIds()).toContain(retiredId);
    reopen();
    expect(scene().groups).toContainEqual(retiredGroup);
    useStore.getState().undo();
    expect(useStore.getState().project).toEqual(beforeRefit);
    useStore.getState().replaceRegistrationJigSet(GRID);
    useStore.setState({ selectedObjectId: 'art', additionalSelectedIds: new Set(['art-right']) });
    useStore.getState().centerSelectionInRegistrationBox();
    expect(scene().groups).toContainEqual(retiredGroup);
    expect(new Set(scene().groups!.map((group) => group.id)).size).toBe(scene().groups!.length);
    expect(
      registrationJigArtworkInstances(scene()).flatMap((instance) =>
        instance.objects.map((object) => object.id),
      ),
    ).not.toContain(retiredId);
  });

  it('prunes operations orphaned by removed-slot artwork while retaining live work and undo', () => {
    const removed = art()[2]!;
    const unique = createLayer({ id: 'retired-only', color: '#abcdef' });
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...scene(),
          layers: [...scene().layers, unique],
          objects: scene().objects.map((object) =>
            object.id === removed.id ? { ...object, operationIds: [unique.id] } : object,
          ),
        },
      },
    }));
    const before = useStore.getState().project;
    const previousIds = outputIds();
    expect(previousIds).toContain(removed.id);
    useStore
      .getState()
      .replaceRegistrationJigSet({ ...GRID, columns: 2, removedArtwork: 'remove' });
    expect(scene().layers.some((operation) => operation.id === unique.id)).toBe(false);
    expect(outputIds()).toEqual(new Set([...previousIds].filter((id) => id !== removed.id)));
    useStore.getState().undo();
    expect(useStore.getState().project).toEqual(before);
  });
});
