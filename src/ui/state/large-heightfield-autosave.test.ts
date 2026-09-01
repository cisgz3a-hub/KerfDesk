import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import { ciBudgetMs } from '../../__fixtures__/ci-budget';
import {
  createProject,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import { createReliefHeightfield } from '../../core/relief/relief-heightfield-factory';
import { AutosaveDurableService } from './autosave-durable';
import { IndexedDbAutosaveRepository } from './autosave-indexeddb';
import { AutosaveSessionLocks } from './autosave-session-lock';

const FIELD_WIDTH = 2_048;
const FIELD_HEIGHT = 2_048;
const SAMPLE_BYTE_COUNT = FIELD_WIDTH * FIELD_HEIGHT * 2;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('large canonical heightfield autosave', () => {
  it(
    'round-trips the full 2048x2048 U16 field through atomic IndexedDB',
    { timeout: ciBudgetMs(15_000, 30_000) },
    async () => {
      const project = largeHeightfieldProject();
      const source = reliefSource(project);
      const service = new AutosaveDurableService({
        repository: new IndexedDbAutosaveRepository({
          factory: new FakeIDBFactory(),
          databaseName: `curvedesk-autosave-large-${crypto.randomUUID()}`,
        }),
        locks: new AutosaveSessionLocks(null),
        initialSessionId: 'large-heightfield',
        rotateSessionId: () => 'large-heightfield-degraded',
      });

      expect(source.samplesBase64).toHaveLength(Math.ceil(SAMPLE_BYTE_COUNT / 3) * 4);
      expect(source.samplesBase64.length).toBeGreaterThan(11_000_000);
      expect(source.digest).toBe(
        'sha256:44cabfc80c072c1e4d7c454829f88a29264ee8d17fcdba7bf23fc0a48419dcd2',
      );
      await expect(service.write(project, 100)).resolves.toMatchObject({
        kind: 'ok',
        backend: 'indexeddb',
      });
      expect(localStorage.length).toBe(0);

      const read = await service.readLatest();
      expect(read.warnings).toEqual([]);
      expect(read.snapshot).toMatchObject({ backend: 'indexeddb', savedAt: 100 });
      const recovered = read.snapshot?.project;
      const recoveredSource = recovered === undefined ? null : reliefSource(recovered);
      expect(recovered?.notes).toBe('large canonical recovery');
      expect(recoveredSource).toEqual(source);
      await service.stop();
    },
  );
});

function largeHeightfieldProject(): Project {
  const samples = new Uint8Array(SAMPLE_BYTE_COUNT);
  samples.fill(0xff);
  samples[0] = 0;
  samples[1] = 0;
  samples[SAMPLE_BYTE_COUNT / 2] = 0x34;
  samples[SAMPLE_BYTE_COUNT / 2 + 1] = 0x12;
  const source = createReliefHeightfield({
    width: FIELD_WIDTH,
    height: FIELD_HEIGHT,
    physicalWidthMm: 204.8,
    physicalHeightMm: 204.8,
    samples,
    mapping: {
      polarity: 'light-is-high',
      inputLowCode: 0,
      inputHighCode: 0xffff,
      curve: { kind: 'gamma-v1', gamma: 1 },
      maxDepthMm: 8,
      crop: { kind: 'normalized-v1', x: 0, y: 0, width: 1, height: 1 },
      aspect: 'preserve',
      inclusionThreshold: 255,
      outsideMask: 'excluded',
    },
    provenance: {
      sourceKind: 'depth-map',
      sourceName: 'large-heightfield.png',
      sourceBitDepth: 16,
      sourcePolarity: 'light-is-high',
    },
  });
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'large-heightfield-relief',
    source: 'large-heightfield.png',
    targetWidthMm: 204.8,
    reliefDepthMm: 8,
    reliefSource: source,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 204.8, maxY: 204.8 },
    transform: IDENTITY_TRANSFORM,
  };
  const project = createProject();
  return {
    ...project,
    notes: 'large canonical recovery',
    scene: { ...project.scene, objects: [relief] },
  };
}

function reliefSource(project: Project) {
  const object = project.scene.objects[0];
  if (object?.kind !== 'relief' || object.reliefSource.kind !== 'heightfield-v1') {
    throw new Error('Expected one canonical relief heightfield.');
  }
  return object.reliefSource;
}
