import { beforeEach, expect, it } from 'vitest';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import { createRegistrationBox } from '../../core/shapes';
import {
  createLayer,
  createRegistrationLayer,
  IDENTITY_TRANSFORM,
  transformedBBox,
  type Scene,
  type TracedImage,
} from '../../core/scene';
import {
  registrationJigArtworkInstances,
  registrationJigCopyId,
} from '../../core/scene/registration-jig-artwork';
import { registrationJigCompilationRuns } from '../../core/job/registration-jig-compilation-runs';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { actions, rings, trace } from './trace-part.test-support';

beforeEach(resetStore);

const SOURCE = 'd9c94761-4f55-4e18-b166-3dbb322a789a';
const BOX_A = '379754e4-b1f1-45b1-853d-75a769147a71';
const BOX_B = '389754e4-b1f1-45b1-853d-75a769147a72';

function loadJig(): void {
  const boxes = [BOX_A, BOX_B].map((id, index) =>
    createRegistrationBox({ id, widthMm: 120, heightMm: 120, x: index * 150 }),
  );
  const source: TracedImage = {
    ...trace([{ ...rings(), operationIds: ['art'] }]),
    id: SOURCE,
    traceMode: 'centerline',
    operationIds: ['art'],
    transform: IDENTITY_TRANSFORM,
  };
  const copy = {
    ...source,
    id: registrationJigCopyId(SOURCE, BOX_B),
    transform: { ...source.transform, x: 150 },
  };
  const scene: Scene = {
    objects: [...boxes, source, copy],
    layers: [
      { ...createRegistrationLayer(), output: false },
      createLayer({ id: 'art', color: '#000000', mode: 'fill' }),
    ],
  };
  useStore.setState((state) => ({ project: { ...state.project, scene } }));
}

function reopen(): void {
  const opened = deserializeProject(serializeProject(useStore.getState().project));
  expect(opened.kind, opened.kind === 'invalid' ? JSON.stringify(opened) : undefined).toBe('ok');
  if (opened.kind !== 'ok') throw new Error('project did not reopen');
  useStore.setState({ project: opened.project });
}

it('copies a selected source and its selected generated descendant exactly once per box', () => {
  loadJig();
  const copyId = registrationJigCopyId(SOURCE, BOX_B);
  useStore.setState({ selectedObjectId: SOURCE, additionalSelectedIds: new Set([copyId]) });
  useStore.getState().centerSelectionInRegistrationBox();
  const first = useStore.getState().project;
  const ids = first.scene.objects.map((object) => object.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(
    registrationJigArtworkInstances(first.scene).map((instance) => instance.objects.length),
  ).toEqual([2, 2]);
  expect(
    registrationJigCompilationRuns(first.scene)?.map((run) => run.vectorObjects.length),
  ).toEqual([2, 2]);
  reopen();
  useStore.getState().centerSelectionInRegistrationBox();
  const repeated = useStore.getState().project.scene;
  expect(new Set(repeated.objects.map((object) => object.id)).size).toBe(repeated.objects.length);
  expect(repeated.objects.map((object) => object.id).sort()).toEqual([...ids].sort());
  expect(
    registrationJigArtworkInstances(repeated).map((instance) => instance.objects.length),
  ).toEqual([2, 2]);
});

it('keeps reachable nested jig splits within the CNC side ID schema and preserves deleted ancestry', () => {
  loadJig();
  const copyId = registrationJigCopyId(SOURCE, BOX_B);
  useStore.setState((state) => ({
    project: {
      ...state.project,
      cncSetup: {
        ...defaultCncMachiningSetup(),
        twoSided: {
          activeSide: 'A',
          sideAObjectIds: [copyId],
          sideBObjectIds: [],
          flipAxis: 'y',
          sideBStockOriginMm: { x: 0, y: 0 },
          registration: [],
        },
      },
    },
  }));
  const outer = actions.detachTracePart(copyId, 0, 0);
  expect(outer).not.toBeNull();
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        layers: state.project.scene.layers.map((layer) =>
          layer.id === 'art' ? { ...layer, mode: 'line' } : layer,
        ),
      },
    },
  }));
  const inner = actions.detachTracePart(outer!, 0, 1);
  expect(inner).not.toBeNull();
  expect(inner).not.toBe(outer);
  expect(inner!.length).toBeLessThanOrEqual(200);
  reopen();
  useStore.getState().removeSceneObject(copyId);
  useStore.getState().removeSceneObject(outer!);
  expect(
    registrationJigArtworkInstances(useStore.getState().project.scene)
      .find((instance) => instance.boxId === BOX_B)
      ?.objects.map((object) => object.id),
  ).toContain(inner);
  useStore.setState({ selectedObjectId: SOURCE, additionalSelectedIds: new Set() });
  useStore.getState().centerSelectionInRegistrationBox();
  expect(useStore.getState().project.scene.objects.some((object) => object.id === inner)).toBe(
    false,
  );
});

it('retains a promoted part in the first box after deleting every generated descendant and reopening', () => {
  loadJig();
  const partId = actions.detachTracePart(registrationJigCopyId(SOURCE, BOX_B), 0, 2)!;
  useStore.setState({ selectedObjectId: partId, additionalSelectedIds: new Set() });
  useStore.getState().centerSelectionInRegistrationBox();
  const promoted = useStore
    .getState()
    .project.scene.objects.find((object) => object.id === partId)!;
  for (const object of useStore.getState().project.scene.objects) {
    if (object.id !== BOX_A && object.id !== BOX_B && object.id !== partId)
      useStore.getState().removeSceneObject(object.id);
  }
  reopen();
  expect(
    registrationJigArtworkInstances(useStore.getState().project.scene).map((instance) => ({
      boxId: instance.boxId,
      ids: instance.objects.map((object) => object.id),
    })),
  ).toEqual([{ boxId: BOX_A, ids: [partId] }]);
  expect(
    registrationJigCompilationRuns(useStore.getState().project.scene)?.map((run) =>
      run.vectorObjects.map((object) => object.id),
    ),
  ).toEqual([[partId]]);
  expect(
    useStore.getState().resizeRegistrationJigArtwork({
      widthMm: 60,
      heightMm: 60,
      preserveAspect: true,
      drivingDimension: 'width',
    }),
  ).toEqual({ kind: 'ok' });
  const resized = useStore.getState().project.scene.objects.find((object) => object.id === partId)!;
  const bounds = transformedBBox(resized);
  expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(60, 8);
  expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(60, 8);
  expect(promoted.transform.x).toBeLessThan(150);
});
