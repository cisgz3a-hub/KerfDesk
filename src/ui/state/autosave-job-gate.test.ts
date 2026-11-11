import { describe, expect, it } from 'vitest';

import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { autosaveHandOffWeight } from './autosave-hand-off-weight';
import {
  AUTOSAVE_JOB_HAND_OFF_LIMIT_MS,
  AUTOSAVE_JOB_HAND_OFF_WEIGHT_LIMIT,
  createAutosaveJobGate,
} from './autosave-job-gate';

const WRITTEN = { kind: 'ok', savedAt: 1, storageKey: 'slot', backend: 'indexeddb' } as const;

function withObjects(objects: ReadonlyArray<unknown>): Project {
  const base = createProject();
  return { ...base, scene: { ...base.scene, objects: objects as ReadonlyArray<SceneObject> } };
}

function vector(id: string, pointCount: number): unknown {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          { closed: false, points: Array.from({ length: pointCount }, (_, x) => ({ x, y: 0 })) },
        ],
      },
    ],
  };
}

function photo(id: string, megapixels: number): unknown {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    // One base64 character carries six bits of an eight-bit luma sample.
    lumaBase64: 'A'.repeat(Math.ceil((megapixels * 1_000_000 * 4) / 3)),
    pixelWidth: 1000,
    pixelHeight: megapixels * 1000,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

describe('autosaveHandOffWeight', () => {
  it('counts embedded text by its length', () => {
    const empty = autosaveHandOffWeight(withObjects([]));
    const withPhoto = autosaveHandOffWeight(withObjects([photo('p', 12)]));
    expect(withPhoto - empty).toBeGreaterThan(16_000_000);
    expect(withPhoto - empty).toBeLessThan(16_100_000);
  });

  it('counts vector geometry by its vertices, not by walking them', () => {
    const sparse = autosaveHandOffWeight(withObjects([vector('v', 10)]));
    const dense = autosaveHandOffWeight(withObjects([vector('v', 100_010)]));
    // What a vertex adds to the copy's text, not what it costs to hand over.
    expect(dense - sparse).toBe(100_000 * 64);
  });

  it('grows with the number of objects', () => {
    const one = autosaveHandOffWeight(withObjects([vector('a', 4)]));
    const many = autosaveHandOffWeight(
      withObjects(Array.from({ length: 1001 }, (_, index) => vector(`o${index}`, 4))),
    );
    expect((many - one) / 1000).toBeGreaterThanOrEqual(4_000);
  });

  it('counts what the document carries outside its objects', () => {
    const base = withObjects([]);
    const noted = { ...base, notes: 'n'.repeat(5_000) };
    expect(autosaveHandOffWeight(noted) - autosaveHandOffWeight(base)).toBe(5_000);
  });

  it('gives the same answer for the same project, and a new one after an edit', () => {
    const kept = photo('kept', 2);
    const before = withObjects([kept, vector('v', 100)]);
    const after = withObjects([kept, vector('v', 200)]);
    expect(autosaveHandOffWeight(before)).toBe(autosaveHandOffWeight(before));
    expect(autosaveHandOffWeight(after) - autosaveHandOffWeight(before)).toBe(100 * 64);
  });
});

describe('createAutosaveJobGate', () => {
  it('lets an ordinary project autosave during a job', () => {
    const gate = createAutosaveJobGate(() => null);
    const ordinary = withObjects(
      Array.from({ length: 200 }, (_, index) => vector(`o${index}`, 50)),
    );
    expect(gate.allows(ordinary)).toBe(true);
    // One 12 MP photo beside a 150,000-point trace is still light.
    expect(gate.allows(withObjects([photo('p', 12), vector('trace', 150_000)]))).toBe(true);
  });

  it('holds back a project whose hand-off is over the limit', () => {
    const gate = createAutosaveJobGate(() => null);
    const fourPhotos = withObjects([1, 2, 3, 4].map((index) => photo(`p${index}`, 12)));
    expect(autosaveHandOffWeight(fourPhotos)).toBeGreaterThan(AUTOSAVE_JOB_HAND_OFF_WEIGHT_LIMIT);
    expect(gate.allows(fourPhotos)).toBe(false);
    const tenThousand = withObjects(
      Array.from({ length: 10_000 }, (_, index) => vector(`o${index}`, 12)),
    );
    expect(gate.allows(tenThousand)).toBe(false);
    // Cheap to hand over, but its copy is 71 million characters in the worker.
    expect(gate.allows(withObjects([vector('trace', 1_000_000)]))).toBe(false);
  });

  it('stops for the rest of the job once a measured hand-off runs over its limit', () => {
    let handOffMs: number | null = 4;
    const gate = createAutosaveJobGate(() => handOffMs);
    const small = withObjects([vector('v', 10)]);

    gate.noteJob(true);
    gate.noteWrite(WRITTEN, true);
    expect(gate.allows(small)).toBe(true);

    handOffMs = AUTOSAVE_JOB_HAND_OFF_LIMIT_MS + 1;
    gate.noteWrite(WRITTEN, true);
    expect(gate.allows(small)).toBe(false);
    gate.noteJob(true);
    expect(gate.allows(small)).toBe(false);

    // The next job starts from the estimate again.
    gate.noteJob(false);
    expect(gate.allows(small)).toBe(true);
  });

  it('ignores a slow hand-off that happened outside a job', () => {
    const gate = createAutosaveJobGate(() => AUTOSAVE_JOB_HAND_OFF_LIMIT_MS * 10);
    gate.noteWrite(WRITTEN, false);
    expect(gate.allows(withObjects([vector('v', 10)]))).toBe(true);
  });

  it('waits while writes are not reaching IndexedDB, and resumes when one does', () => {
    const gate = createAutosaveJobGate(() => 1);
    const small = withObjects([vector('v', 10)]);

    // The localStorage fallback writes the whole project text on this thread.
    gate.noteWrite({ ...WRITTEN, backend: 'local' }, false);
    expect(gate.allows(small)).toBe(false);

    gate.noteWrite(WRITTEN, false);
    expect(gate.allows(small)).toBe(true);

    gate.noteWrite({ kind: 'failed', reason: 'quota', error: new Error('full') }, false);
    expect(gate.allows(small)).toBe(false);

    // A newer copy winning says nothing about storage either way.
    gate.noteWrite({ kind: 'superseded' }, false);
    expect(gate.allows(small)).toBe(false);
    gate.noteWrite(WRITTEN, false);
    gate.noteWrite({ kind: 'superseded' }, false);
    expect(gate.allows(small)).toBe(true);
  });
});
