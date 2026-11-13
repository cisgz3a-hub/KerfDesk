import { expect, test } from '@playwright/test';

import { attributeLongTasks } from './fixtures/long-task-attribution';

// The camera guard's attribution (ADR-598 Amendments 7 and 8) on synthetic CPU
// profiles. No page: these check the arithmetic the camera spec relies on.

const ROOT = 1;
const MARKER = 2;
const GC = 3;
const PROGRAM = 4;
const CAMERA = 5;
const REACT = 6;
const DRIVER = 7;

const PROFILE_NODES = [
  { id: ROOT, callFrame: { functionName: '(root)', url: '' }, children: [MARKER, GC, PROGRAM] },
  {
    id: MARKER,
    callFrame: { functionName: 'zzLongTaskProfileMarker', url: 'http://127.0.0.1/e2e' },
    children: [CAMERA, REACT],
  },
  { id: GC, callFrame: { functionName: '(garbage collector)', url: '' } },
  { id: PROGRAM, callFrame: { functionName: '(program)', url: '' } },
  {
    id: CAMERA,
    callFrame: { functionName: 'decodePicture', url: 'http://127.0.0.1/src/ui/camera/picture.ts' },
    children: [DRIVER],
  },
  {
    id: REACT,
    callFrame: { functionName: 'performWork', url: 'http://127.0.0.1/node_modules/react-dom.js' },
  },
  {
    id: DRIVER,
    callFrame: {
      functionName: 'texImage2D',
      url: 'http://127.0.0.1/src/ui/camera/bed-overlay-renderer.ts',
    },
  },
];

// One sample a millisecond. The first is the clock marker at page time 0, and
// the task covers every sample after it.
function cameraShare(...runs: readonly (readonly [number, number])[]): number {
  const samples = [MARKER, ...runs.flatMap(([id, count]) => Array<number>(count).fill(id))];
  const [task] = attributeLongTasks({
    profile: { nodes: PROFILE_NODES, samples, timeDeltas: samples.map(() => 1_000) },
    markedAt: 0,
    tasks: [{ startMs: 1, durationMs: samples.length - 1 }],
    ownedPath: '/src/ui/camera/',
    driverPath: 'bed-overlay-renderer',
  });
  return Math.round((task?.ownedShare ?? Number.NaN) * 100) / 100;
}

test('a camera task that is mostly its own garbage collection is the camera’s', () => {
  // E3-P3-2 case D: 45 % camera decode, then 55 % collecting its garbage.
  // Counted against all samples this was 0.45 and passed the 0.5 guard.
  expect(cameraShare([CAMERA, 45], [GC, 55])).toBe(1);
  // Interleaved, as a real profile is.
  expect(cameraShare([CAMERA, 9], [GC, 11], [CAMERA, 9], [GC, 11], [CAMERA, 9], [GC, 11])).toBe(1);
});

test('garbage collection after other script is not the camera’s', () => {
  expect(cameraShare([REACT, 45], [GC, 55])).toBe(0);
  expect(cameraShare([CAMERA, 20], [REACT, 30], [GC, 50])).toBe(0.2);
  // A job render that collects garbage still passes beside a little camera work.
  expect(cameraShare([CAMERA, 10], [GC, 10], [REACT, 60], [GC, 20])).toBe(0.2);
});

test('the driver file’s samples and work with no script stay unattributed', () => {
  // The overlay's WebGL wrapper is the GPU's time, and so is its garbage.
  expect(cameraShare([DRIVER, 50], [GC, 50])).toBe(0);
  // Native work with no script on the stack is left to the structural checks.
  expect(cameraShare([CAMERA, 40], [PROGRAM, 60])).toBe(0.4);
  // Garbage collected after native work belongs to the last script that ran.
  expect(cameraShare([CAMERA, 30], [PROGRAM, 20], [GC, 50])).toBe(0.8);
});
