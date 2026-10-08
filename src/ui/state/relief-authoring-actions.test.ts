import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  testAuthoringRelief,
  testLinkedReliefDocument,
  testMaterializedRelief,
  testReliefBoundary,
} from '../../__fixtures__/relief-authoring';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, IDENTITY_TRANSFORM } from '../../core/scene';
import type { HeightfieldReliefObject, SceneObject } from '../../core/scene/scene-object';
import type { ReliefAuthoringDocument } from '../../core/scene/relief/relief-authoring';
import {
  createReliefAuthoringDocument,
  reviseReliefDocument,
} from '../../core/relief/relief-authoring-document';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(resetStore);
afterEach(resetStore);
function install(relief = testAuthoringRelief(), extra: readonly SceneObject[] = []): void {
  useStore.setState({
    project: {
      ...createProject(),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: { layers: [], objects: [relief, ...extra] },
    },
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
}
function current(): HeightfieldReliefObject {
  const object = useStore.getState().project.scene.objects.find((o) => o.id === 'relief');
  if (object?.kind !== 'relief' || object.reliefSource.kind !== 'heightfield-v1')
    throw new Error('Missing relief.');
  return object as HeightfieldReliefObject;
}
function scaled(document: ReliefAuthoringDocument, scale: number): ReliefAuthoringDocument {
  return reviseReliefDocument(document, {
    components: document.components.map((c) => ({ ...c, heightScale: scale })),
  });
}
function commit(document: ReliefAuthoringDocument, captured = current()): boolean {
  return useStore
    .getState()
    .commitReliefAuthoring(
      captured.id,
      captured.reliefAuthoring?.revision ?? null,
      document,
      testMaterializedRelief(document),
      { source: captured.reliefSource, documentEpoch: useStore.getState().projectDocumentEpoch },
    );
}

describe('relief authoring mutation ownership', () => {
  it('commits retained intent and materialized U16 together as one exact undo/redo step', () => {
    const original = testAuthoringRelief();
    install(original);
    const before = useStore.getState().project;
    const doc = scaled(createReliefAuthoringDocument(original.reliefSource), 2);
    const field = testMaterializedRelief(doc);
    expect(
      useStore.getState().commitReliefAuthoring('relief', null, doc, field, {
        source: original.reliefSource,
        documentEpoch: 0,
      }),
    ).toBe(true);
    expect(current().reliefAuthoring).toBe(doc);
    expect(current().reliefSource).toBe(field);
    expect(current().reliefSource.samplesBase64).not.toBe(original.reliefSource.samplesBase64);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(useStore.getState().dirty).toBe(true);
    const edited = useStore.getState().project;
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    expect(current().reliefSource).toBe(original.reliefSource);
    expect(current().reliefAuthoring).toBeUndefined();
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(edited);
    expect(current().reliefAuthoring?.revision).toBe(current().reliefSource.revision);
  });
  it('rejects a worker result after a canonical mapping edit detached authoring', () => {
    const original = testAuthoringRelief();
    install(original);
    const doc = scaled(createReliefAuthoringDocument(original.reliefSource), 2);
    const field = testMaterializedRelief(doc);
    useStore.getState().setReliefParams('relief', { polarity: 'light-is-deep' });
    const after = useStore.getState().project;
    expect(
      useStore.getState().commitReliefAuthoring('relief', null, doc, field, {
        source: original.reliefSource,
        documentEpoch: 0,
      }),
    ).toBe(false);
    expect(useStore.getState().project).toBe(after);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(current().reliefAuthoring).toBeUndefined();
  });
  it('rejects a result from an older document epoch even when source identity and id survive reopen', () => {
    const original = testAuthoringRelief();
    install(original);
    const doc = scaled(createReliefAuthoringDocument(original.reliefSource), 2);
    const field = testMaterializedRelief(doc);
    useStore.getState().setProject(useStore.getState().project);
    const after = useStore.getState().project;
    expect(useStore.getState().projectDocumentEpoch).toBe(1);
    expect(current().reliefSource).toBe(original.reliefSource);
    expect(
      useStore.getState().commitReliefAuthoring('relief', null, doc, field, {
        source: original.reliefSource,
        documentEpoch: 0,
      }),
    ).toBe(false);
    expect(useStore.getState().project).toBe(after);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
  it('rejects revision collisions after undo and a different composition branch', () => {
    const original = testAuthoringRelief();
    install(original);
    const initial = createReliefAuthoringDocument(original.reliefSource);
    expect(commit(scaled(initial, 2), original)).toBe(true);
    const captured = current(),
      pending = scaled(captured.reliefAuthoring ?? initial, 3),
      field = testMaterializedRelief(pending);
    useStore.getState().undo();
    expect(commit(scaled(initial, 4), original)).toBe(true);
    expect(current().reliefAuthoring?.revision).toBe(captured.reliefAuthoring?.revision);
    const after = useStore.getState().project;
    expect(
      useStore
        .getState()
        .commitReliefAuthoring(
          'relief',
          captured.reliefAuthoring?.revision ?? null,
          pending,
          field,
          { source: captured.reliefSource, documentEpoch: 0 },
        ),
    ).toBe(false);
    expect(useStore.getState().project).toBe(after);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
  it.each([{ targetWidthMm: 12 }, { reliefDepthMm: 10 }])(
    'rejects an initial attachment against stale physical mapping %o',
    (patch) => {
      const original = { ...testAuthoringRelief(), ...patch };
      install(original);
      const before = useStore.getState().project;
      expect(
        commit(scaled(createReliefAuthoringDocument(original.reliefSource), 2), original),
      ).toBe(false);
      expect(useStore.getState().project).toBe(before);
      expect(useStore.getState().undoStack).toHaveLength(0);
    },
  );
  it('rejects an unowned field that does not materialize the retained document', () => {
    const original = testAuthoringRelief();
    install(original);
    const doc = scaled(createReliefAuthoringDocument(original.reliefSource), 2);
    expect(
      useStore.getState().commitReliefAuthoring('relief', null, doc, {
        ...original.reliefSource,
        revision: doc.revision,
      }),
    ).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});

describe('linked relief mutations', () => {
  it.each(['boundary', 'mask'])(
    'refreshes linked %s and canonical field inside the originating undo step',
    (id) => {
      const original = testAuthoringRelief(),
        doc = testLinkedReliefDocument(original);
      const relief = {
        ...original,
        reliefAuthoring: doc,
        reliefSource: testMaterializedRelief(doc),
      };
      install(relief, [testReliefBoundary(), testReliefBoundary('mask')]);
      const before = useStore.getState().project;
      useStore.getState().applyObjectTransform(id, { ...IDENTITY_TRANSFORM, x: 3 });
      const edited = useStore.getState().project,
        changed = current();
      expect(changed.reliefAuthoring?.revision).toBe(doc.revision + 1);
      expect(changed.reliefSource.revision).toBe(changed.reliefAuthoring?.revision);
      expect(changed.reliefSource.samplesBase64).not.toBe(relief.reliefSource.samplesBase64);
      const component = changed.reliefAuthoring?.components[1];
      const mask =
        id === 'mask'
          ? component?.mask
          : component?.source.kind === 'vector-shape-v1'
            ? component.source.boundary
            : undefined;
      expect(mask?.rings[0]?.points[0]?.x).toBe(3);
      expect(useStore.getState().undoStack).toEqual([before]);
      useStore.getState().undo();
      expect(useStore.getState().project).toBe(before);
      expect(current().reliefSource).toBe(relief.reliefSource);
      expect(current().reliefAuthoring).toBe(doc);
      useStore.getState().redo();
      expect(useStore.getState().project).toBe(edited);
      expect(current().reliefSource).toBe(changed.reliefSource);
    },
  );
  it('keeps one drag undo snapshot while its linked source refreshes several times', () => {
    const original = testAuthoringRelief(),
      doc = testLinkedReliefDocument(original);
    install({ ...original, reliefAuthoring: doc, reliefSource: testMaterializedRelief(doc) }, [
      testReliefBoundary(),
      testReliefBoundary('mask'),
    ]);
    const before = useStore.getState().project;
    useStore.getState().beginInteraction();
    useStore.getState().setObjectTransform('boundary', { ...IDENTITY_TRANSFORM, x: 1 });
    useStore.getState().setObjectTransform('boundary', { ...IDENTITY_TRANSFORM, x: 2 });
    useStore.getState().endInteraction();
    expect(current().reliefAuthoring?.revision).toBe(doc.revision + 2);
    expect(useStore.getState().undoStack).toEqual([before]);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    expect(current().reliefAuthoring).toBe(doc);
  });
});
