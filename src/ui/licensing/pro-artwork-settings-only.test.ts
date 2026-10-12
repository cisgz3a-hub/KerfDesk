import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Project, SceneObject } from '../../core/scene';
import {
  testAuthoringRelief,
  testLinkedReliefDocument,
  testMaterializedRelief,
  testReliefBoundary,
} from '../../__fixtures__/relief-authoring';
import { proProject } from '../app/pro-project-test-fixtures';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { setActiveEdition, UNRESTRICTED_EDITION, type EditionValue } from './edition';
import { freeProArtworkSetter } from './pro-operation-mutation';
import {
  changedProArtworkFeature,
  newlyIntroducedProOperationFeature,
} from './pro-operation-policy';

const requestPro = vi.fn(() => false);
const FREE: EditionValue = {
  status: null,
  licensed: true,
  pro: false,
  requestPro,
  openLicence: () => undefined,
};

beforeEach(() => {
  resetStore();
  setActiveEdition(FREE);
  vi.clearAllMocks();
});
afterEach(() => setActiveEdition(null));

/** A V-carve template: the text artwork is bound to the V-carve operation. */
function template(): Project {
  const project = proProject();
  return withObject(project, 'text', (object) => ({ ...object, operationIds: ['pro-operation'] }));
}

function withObject(
  project: Project,
  id: string,
  change: (object: SceneObject) => SceneObject,
): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((object) => (object.id === id ? change(object) : object)),
    },
  };
}

const relettered = (project: Project) =>
  withObject(project, 'text', (object) =>
    object.kind === 'text'
      ? {
          ...object,
          content: 'Any lettering',
          paths: [...object.paths, ...object.paths],
        }
      : object,
  );

it('asks for Pro when Free changes the artwork of existing V-carve work (ADR-592)', () => {
  const before = template();
  expect(changedProArtworkFeature(before, relettered(before))).toBe('vcarve');
  // Weld and other geometry edits use the narrower operation check: it asks too.
  expect(newlyIntroducedProOperationFeature(before, relettered(before))).toBe('vcarve');
});

it('keeps settings, placement and removal of existing Pro work free', () => {
  const before = template();
  const moved = withObject(before, 'text', (object) => ({
    ...object,
    transform: { ...object.transform, x: object.transform.x + 25, scaleX: 2 },
  }));
  expect(changedProArtworkFeature(before, moved)).toBeNull();
  const deeper: Project = {
    ...before,
    scene: {
      ...before.scene,
      layers: before.scene.layers.map((layer) =>
        layer.cnc === undefined ? layer : { ...layer, cnc: { ...layer.cnc, depthMm: 4 } },
      ),
    },
  };
  expect(changedProArtworkFeature(before, deeper)).toBeNull();
  const removed: Project = {
    ...before,
    scene: { ...before.scene, objects: before.scene.objects.filter((o) => o.id !== 'text') },
  };
  expect(changedProArtworkFeature(before, removed)).toBeNull();
  // Ordinary artwork stays fully editable in Free.
  const plain = proProject();
  expect(changedProArtworkFeature(plain, relettered(plain))).toBeNull();
});

it('refuses an ungated store edit to Pro artwork in Free and applies it with Pro', async () => {
  const before = template();
  useStore.setState({ project: before });
  const set = freeProArtworkSetter(useStore.setState);
  set((state) => ({ project: relettered(state.project) }));
  expect(useStore.getState().project).toBe(before);
  await Promise.resolve();
  expect(requestPro).toHaveBeenCalledWith('vcarve', undefined);
  setActiveEdition(UNRESTRICTED_EDITION);
  set((state) => ({ project: relettered(state.project) }));
  expect(useStore.getState().project).not.toBe(before);
});

it('never blocks replacing the whole document', () => {
  useStore.setState({ project: template(), projectDocumentEpoch: 1 });
  const set = freeProArtworkSetter(useStore.setState);
  const next = relettered(template());
  set({ project: next, projectDocumentEpoch: 2 });
  expect(useStore.getState().project).toBe(next);
});

it('refuses edits to linked Free artwork that would change a relief after link refresh', async () => {
  const relief = testAuthoringRelief();
  const document = testLinkedReliefDocument(relief);
  const project = proProject({ cutType: 'profile-outside' });
  const before: Project = {
    ...project,
    scene: {
      ...project.scene,
      objects: [
        { ...relief, reliefAuthoring: document, reliefSource: testMaterializedRelief(document) },
        testReliefBoundary(),
        testReliefBoundary('mask'),
      ],
    },
  };
  useStore.setState({ project: before, dirty: false, undoStack: [] });
  useStore.getState().setObjectTransform('boundary', {
    ...testReliefBoundary().transform,
    x: 2,
  });
  expect(useStore.getState().project).toBe(before);
  expect(useStore.getState().dirty).toBe(false);
  expect(useStore.getState().undoStack).toEqual([]);
  await Promise.resolve();
  expect(requestPro).toHaveBeenCalledWith('relief', undefined);
});

it('refuses a new relief through a generic artwork setter in Free', async () => {
  const before = proProject({ cutType: 'profile-outside' });
  useStore.setState({ project: before });
  useStore.getState().importRasterImage(testAuthoringRelief());
  expect(useStore.getState().project).toBe(before);
  await Promise.resolve();
  expect(requestPro).toHaveBeenCalledWith('relief', undefined);
});

it('refuses replacing variable Pro artwork data while allowing progression within its saved data', async () => {
  const project = withObject(template(), 'text', (object) =>
    object.kind === 'text'
      ? { ...object, variableTemplate: { tokens: [{ kind: 'csv', column: 'name' }] } }
      : object,
  );
  const before: Project = {
    ...project,
    scene: {
      ...project.scene,
      layers: project.scene.layers.map((layer) => ({ ...layer, output: true })),
    },
    variables: {
      recordIndex: 0,
      serialValue: 1,
      advancement: 'after-successful-export',
      csv: { sourceName: 'names.csv', headers: ['name'], records: [['Alice'], ['Bob']] },
    },
  };
  useStore.setState({ project: before });
  useStore.getState().setVariableCsv({
    sourceName: 'other.csv',
    headers: ['name'],
    records: [['New artwork']],
  });
  expect(useStore.getState().project).toBe(before);
  await Promise.resolve();
  expect(requestPro).toHaveBeenCalledWith('vcarve', undefined);

  requestPro.mockClear();
  useStore.getState().advanceVariablesAfter(before, 'successful-export');
  expect(useStore.getState().project.variables?.recordIndex).toBe(1);
  expect(requestPro).not.toHaveBeenCalled();
});

it('detects a new variable template even when its cached paths are unchanged', () => {
  const before = template();
  const after = withObject(before, 'text', (object) =>
    object.kind === 'text'
      ? {
          ...object,
          variableTemplate: { tokens: [{ kind: 'literal', value: 'New artwork at output' }] },
        }
      : object,
  );
  expect(changedProArtworkFeature(before, after)).toBe('vcarve');
});
