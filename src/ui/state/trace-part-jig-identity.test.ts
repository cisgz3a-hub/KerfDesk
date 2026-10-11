import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job/compile-job';
import { registrationJigCompilationRuns } from '../../core/job/registration-jig-compilation-runs';
import { createRegistrationBox } from '../../core/shapes';
import {
  createLayer,
  createRegistrationLayer,
  combinedBBox,
  IDENTITY_TRANSFORM,
  type Scene,
  type TracedImage,
} from '../../core/scene';
import {
  registrationJigArtworkInstances,
  registrationJigCopyId,
  registrationJigCopyIdentity,
} from '../../core/scene/registration-jig-artwork';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { actions, rings, trace } from './trace-part.test-support';

describe('trace parts retain their physical registration-jig instance', () => {
  beforeEach(resetStore);

  it.each(['box:a/%', 'box:b/%'])(
    'keeps a detached part in %s through output, save and undo',
    (boxId) => {
      const scene = jigScene();
      useStore.setState((state) => ({ project: { ...state.project, scene } }));
      const original = useStore.getState().project;
      const objectId =
        boxId === 'box:a/%' ? 'trace:source/%' : registrationJigCopyId('trace:source/%', boxId);
      const partId = actions.detachTracePart(objectId, 0, 2);
      expect(partId).not.toBeNull();
      const edited = useStore.getState().project;
      const expected = instances(scene).map((instance) => ({
        ...instance,
        objectIds: instance.boxId === boxId ? [...instance.objectIds, partId] : instance.objectIds,
      }));
      expect(instances(edited.scene)).toEqual(expected);
      expect(registrationJigCopyIdentity(partId!)).toMatchObject({ boxId });

      const runs = registrationJigCompilationRuns(edited.scene);
      expect(runs).toHaveLength(6);
      expect(runs?.map((run) => run.layer.id)).toEqual([
        'fill',
        'line',
        'fill',
        'line',
        'fill',
        'line',
      ]);
      for (const [index, run] of (runs ?? []).entries()) {
        expect(run.vectorObjects.map((object) => object.id)).toEqual(
          expected[Math.floor(index / 2)]?.objectIds,
        );
      }
      const ownership = new Map(
        expected.flatMap((instance) =>
          instance.objectIds.map((id) => [id, instance.boxId] as const),
        ),
      );
      const outputBoxes = compileJob(edited.scene, DEFAULT_DEVICE_PROFILE).groups.map((group) =>
        ownership.get(group.sourceObjectId ?? ''),
      );
      expect(outputBoxes).not.toContain(undefined);
      expect(outputBoxes.filter((box, index) => box !== outputBoxes[index - 1])).toEqual(
        expected.map((instance) => instance.boxId),
      );

      const reopened = deserializeProject(serializeProject(edited));
      expect(reopened.kind, JSON.stringify(reopened)).toBe('ok');
      if (reopened.kind !== 'ok') throw new Error('project did not reopen');
      expect(instances(reopened.project.scene)).toEqual(expected);
      expect(
        reopened.project.scene.objects.find((object) => object.id === partId)?.transform,
      ).toEqual(edited.scene.objects.find((object) => object.id === objectId)?.transform);
      useStore.getState().undo();
      expect(useStore.getState().project).toBe(original);
      useStore.getState().redo();
      expect(instances(useStore.getState().project.scene)).toEqual(expected);
      expect(
        useStore.getState().resizeRegistrationJigArtwork({
          widthMm: 60,
          heightMm: 60,
          preserveAspect: true,
          drivingDimension: 'width',
        }),
      ).toEqual({ kind: 'ok' });
      for (const instance of registrationJigArtworkInstances(useStore.getState().project.scene)) {
        const bounds = combinedBBox(instance.objects);
        expect(bounds).not.toBeNull();
        expect(bounds!.maxX - bounds!.minX).toBeCloseTo(60, 8);
      }
    },
  );

  it('reapplying the source removes descendants of replaced copies without dropping a first-outline part', () => {
    const scene = jigScene();
    useStore.setState((state) => ({ project: { ...state.project, scene } }));
    const originalPart = actions.detachTracePart('trace:source/%', 0, 2);
    const copyId = registrationJigCopyId('trace:source/%', 'box:b/%');
    const copiedPart = actions.detachTracePart(copyId, 0, 2);
    expect(originalPart).not.toBeNull();
    expect(copiedPart).not.toBeNull();
    // The encoded source lineage must still be understood after deleting a remainder.
    useStore.getState().removeSceneObject(copyId);
    useStore.setState({ selectedObjectId: 'trace:source/%', additionalSelectedIds: new Set() });
    const before = useStore.getState().project;

    useStore.getState().centerSelectionInRegistrationBox();

    const updated = useStore.getState().project.scene;
    expect(updated.objects.some((object) => object.id === copiedPart)).toBe(false);
    expect(updated.objects.some((object) => object.id === originalPart)).toBe(true);
    expect(instances(updated)).toEqual([
      { boxId: 'box:a/%', objectIds: ['trace:source/%', originalPart] },
      { boxId: 'box:b/%', objectIds: [copyId] },
      { boxId: 'box:c/%', objectIds: [registrationJigCopyId('trace:source/%', 'box:c/%')] },
    ]);
    expect(updated.objects.filter((object) => object.kind === 'traced-image')).toHaveLength(4);
    expect(registrationJigCompilationRuns(updated)).toHaveLength(6);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    useStore.getState().redo();
    expect(useStore.getState().project.scene).toEqual(updated);
  });

  it('keeps both jig instances in shared sizing and output after deleting the copied remainder', () => {
    const initial = jigScene();
    const scene = {
      ...initial,
      objects: initial.objects.filter(
        (object) =>
          object.id !== 'box:c/%' &&
          object.id !== registrationJigCopyId('trace:source/%', 'box:c/%'),
      ),
    };
    useStore.setState((state) => ({ project: { ...state.project, scene } }));
    const copyId = registrationJigCopyId('trace:source/%', 'box:b/%');
    const partId = actions.detachTracePart(copyId, 0, 2);
    expect(partId).not.toBeNull();
    useStore.getState().removeSceneObject(copyId);
    const edited = useStore.getState().project;
    const expected = [
      { boxId: 'box:a/%', objectIds: ['trace:source/%'] },
      { boxId: 'box:b/%', objectIds: [partId] },
    ];
    expect(instances(edited.scene)).toEqual(expected);
    expect(
      registrationJigCompilationRuns(edited.scene)?.map((run) =>
        run.vectorObjects.map((object) => object.id),
      ),
    ).toEqual([['trace:source/%'], ['trace:source/%'], [partId], [partId]]);
    const reopened = deserializeProject(serializeProject(edited));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind !== 'ok') throw new Error('project did not reopen');
    expect(instances(reopened.project.scene)).toEqual(expected);
    expect(
      useStore.getState().resizeRegistrationJigArtwork({
        widthMm: 60,
        heightMm: 60,
        preserveAspect: true,
        drivingDimension: 'width',
      }),
    ).toEqual({ kind: 'ok' });
    const resized = useStore.getState().project;
    for (const instance of registrationJigArtworkInstances(resized.scene)) {
      const bounds = combinedBBox(instance.objects);
      expect(bounds!.maxX - bounds!.minX).toBeCloseTo(60, 8);
    }
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(edited);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(resized);
  });

  it('uses a detached copy as the new first-outline source when explicitly copied across the jig', () => {
    const scene = jigScene();
    useStore.setState((state) => ({ project: { ...state.project, scene } }));
    const copyId = registrationJigCopyId('trace:source/%', 'box:b/%');
    const partId = actions.detachTracePart(copyId, 0, 2);
    if (partId === null) throw new Error('part did not detach');
    useStore.setState({ selectedObjectId: partId, additionalSelectedIds: new Set() });

    useStore.getState().centerSelectionInRegistrationBox();

    const updated = useStore.getState().project.scene;
    expect(instances(updated)).toEqual([
      { boxId: 'box:a/%', objectIds: ['trace:source/%', partId] },
      { boxId: 'box:b/%', objectIds: [copyId, registrationJigCopyId(partId, 'box:b/%')] },
      {
        boxId: 'box:c/%',
        objectIds: [
          registrationJigCopyId('trace:source/%', 'box:c/%'),
          registrationJigCopyId(partId, 'box:c/%'),
        ],
      },
    ]);
    useStore.getState().centerSelectionInRegistrationBox();
    expect(instances(useStore.getState().project.scene)).toEqual(instances(updated));
    expect(useStore.getState().project.scene.objects).toHaveLength(updated.objects.length);
  });

  it('keeps detached artwork exactly once when the jig outlines are removed', () => {
    const scene = jigScene();
    useStore.setState((state) => ({ project: { ...state.project, scene } }));
    const partId = actions.detachTracePart(
      registrationJigCopyId('trace:source/%', 'box:b/%'),
      0,
      2,
    );
    const before = useStore.getState().project;
    useStore.getState().removeRegistrationBox();
    const removed = useStore.getState().project.scene;
    expect(instances(removed)).toEqual([]);
    expect(registrationJigCompilationRuns(removed)).toBeNull();
    expect(removed.objects.map((object) => object.id)).toEqual(
      before.scene.objects
        .filter((object) => object.kind === 'traced-image')
        .map((object) => object.id),
    );
    expect(removed.objects.filter((object) => object.id === partId)).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });
});

function instances(scene: Scene) {
  return registrationJigArtworkInstances(scene).map((instance) => ({
    boxId: instance.boxId,
    objectIds: instance.objects.map((object) => object.id),
  }));
}

function jigScene(): Scene {
  const boxes = ['box:a/%', 'box:b/%', 'box:c/%'].map((id, index) =>
    createRegistrationBox({ id, widthMm: 120, heightMm: 120, x: index * 150 }),
  );
  const object: TracedImage = {
    ...trace([{ ...rings(), operationIds: ['fill', 'line'] }]),
    id: 'trace:source/%',
    operationIds: ['fill', 'line'],
    transform: IDENTITY_TRANSFORM,
  };
  return {
    objects: [
      ...boxes,
      object,
      ...boxes.slice(1).map((box, index) => ({
        ...object,
        id: registrationJigCopyId(object.id, box.id),
        transform: { ...object.transform, x: (index + 1) * 150 },
      })),
    ],
    layers: [
      { ...createRegistrationLayer(), output: false },
      { ...createLayer({ id: 'fill', color: '#000000', mode: 'fill' }), hatchSpacingMm: 4 },
      createLayer({ id: 'line', color: '#0000ff', mode: 'line' }),
    ],
  };
}
