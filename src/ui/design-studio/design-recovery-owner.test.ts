import { beforeEach, expect, it, vi } from 'vitest';
import type { Sketch } from '../../core/design';
import { sha256Hex } from '../../core/relief/sha256';
import { createProject, polylineToCurveSubpath, type Project } from '../../core/scene';
import { applyDesignSketch } from '../state/design-apply-mutation';
import { resetStore, svgObj } from '../state/test-helpers';
import { useStore } from '../state';
import { designRecoveryOwner } from './design-recovery-owner';
import { hashRecoveryIdentity, RecoveryHash } from './design-recovery-hash';
import { clearPersistedSession, writePersistedSession } from './design-session-storage';
import { useDesignStudioStore } from './design-studio-store';
import { restoreProjectDesignSession } from './project-design-session';
import { sessionSketch } from './design-session';

const drawing: Sketch = {
  entities: [{ id: 'line', kind: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }],
};

function projectFor(sketch = drawing): Project {
  const applied = applyDesignSketch({ project: createProject(), undoStack: [] }, sketch, ['out']);
  if (applied === null) throw new Error('Apply failed');
  return applied.project;
}

function originalOwner(project: Project): string {
  const document = project.designStudioDocument;
  const linked = new Set(document?.appliedObjectIds ?? []);
  const identity = JSON.stringify({
    sheet: project.sheetBook?.activeId,
    document,
    objects: project.scene.objects.map((object) => {
      if (!linked.has(object.id) || (object.kind !== 'shape' && object.kind !== 'imported-svg'))
        return [object.id, object.kind];
      return [
        object.id,
        object.kind,
        object.transform,
        object.kind === 'shape' ? object.spec : null,
        object.paths.map((path) => [
          path.color,
          path.curves ?? path.polylines.map(polylineToCurveSubpath),
          path.polylines,
        ]),
      ];
    }),
  });
  return `sha256:${sha256Hex([new TextEncoder().encode(identity)])}`;
}

beforeEach(() => {
  resetStore();
  clearPersistedSession();
  useDesignStudioStore.getState().closeStudio();
  useDesignStudioStore.setState({ session: null, stash: null, documentEpoch: -1 });
});

it('keeps existing recovery digests including lazily normalized output curves', async () => {
  const project = projectFor();
  const withoutCurves = {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((object) =>
        object.kind !== 'imported-svg'
          ? object
          : {
              ...object,
              paths: object.paths.map(({ curves: _curves, ...path }) => path),
            },
      ),
    },
  };
  expect(await designRecoveryOwner(project)).toBe(originalOwner(project));
  expect(await designRecoveryOwner(withoutCurves)).toBe(originalOwner(withoutCurves));
});

it('preserves JSON string bytes across escaped and surrogate-pair slice boundaries', async () => {
  const value = {
    text: `${'a'.repeat(2047)}😀\\\n\u0000${'x'.repeat(40000)}\ud800`,
    optional: undefined,
    array: [null, undefined, -0],
  };
  const expected = `sha256:${sha256Hex([new TextEncoder().encode(JSON.stringify(value))])}`;
  expect(await hashRecoveryIdentity(value)).toBe(expected);
});

it('lets pending input run throughout a large supported drawing fingerprint', async () => {
  const project = projectFor({
    entities: [
      {
        id: 'large',
        kind: 'path',
        construction: true,
        closed: false,
        points: Array.from({ length: 100_000 }, (_, index) => ({ x: index, y: index })),
      },
    ],
  });
  let inputTurns = 0;
  const timer = setInterval(() => inputTurns++, 0);
  try {
    const expected = originalOwner(project);
    expect(inputTurns).toBe(0); // Reproduces the old uninterrupted main-thread operation.
    const pending = designRecoveryOwner(project);
    expect(inputTurns).toBe(0);
    expect(await pending).toBe(expected);
    expect(inputTurns).toBeGreaterThan(3);
    expect(designRecoveryOwner(project)).toBe(expected);
  } finally {
    clearInterval(timer);
  }
}, 20_000);

async function prepareRecovery(): Promise<Project> {
  const original = projectFor();
  const session = restoreProjectDesignSession(original);
  writePersistedSession({
    projectOwner: (await designRecoveryOwner(original))!,
    sketch: { entities: [...drawing.entities, { ...drawing.entities[0]!, id: 'draft' }] },
    activeLayerId: session.activeLayerId,
    surface3d: false,
    applied: session.applied,
    dirtySinceApply: true,
  });
  const project = { ...original };
  useStore.setState({ project, projectDocumentEpoch: 1 });
  return project;
}

it('does not reopen a closed studio when an owned draft hash completes', async () => {
  await prepareRecovery();
  const opening = useDesignStudioStore.getState().openStudio();
  expect(useDesignStudioStore.getState().session).toBeNull();
  useDesignStudioStore.getState().closeStudio();
  await opening;
  expect(useDesignStudioStore.getState().session).toBeNull();
  expect(useDesignStudioStore.getState().stash).toBeNull();
});

it('does not restore an old owned draft after the project is replaced during hashing', async () => {
  await prepareRecovery();
  const opening = useDesignStudioStore.getState().openStudio();
  useStore.setState({ project: createProject(), projectDocumentEpoch: 2 });
  await opening;
  expect(useDesignStudioStore.getState().documentEpoch).toBe(2);
  expect(sessionSketch(useDesignStudioStore.getState().session!).entities).toEqual([]);
});

it('rechecks the owner after a same-epoch project edit while opening', async () => {
  const project = await prepareRecovery();
  const opening = useDesignStudioStore.getState().openStudio();
  useStore.setState({
    project: {
      ...project,
      scene: {
        ...project.scene,
        objects: [...project.scene.objects, svgObj('other', ['#000000'])],
      },
    },
  });
  await opening;
  expect(sessionSketch(useDesignStudioStore.getState().session!).entities).toEqual(
    drawing.entities,
  );
});

it('finishes a partially hashed identity without reading completed geometry twice', async () => {
  vi.useFakeTimers();
  let reads = 0;
  const value = Array.from({ length: 10_000 }, (_, index) => ({
    get x() {
      reads++;
      return index;
    },
  }));
  const expected = `sha256:${sha256Hex([new TextEncoder().encode(JSON.stringify(value))])}`;
  reads = 0;
  try {
    const job = new RecoveryHash(value);
    vi.advanceTimersByTime(0);
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThan(value.length);
    expect(job.finishAtTeardown()).toBe(expected);
    expect(reads).toBe(value.length);
    expect(await job.result).toBe(expected);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
