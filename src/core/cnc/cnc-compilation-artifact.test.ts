import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { applyJobOriginOffset, optimizePaths } from '../job';
import { cncGrblStrategy } from '../output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncMachineConfig,
  type CncTool,
  type Polyline,
  type Scene,
  type TextObject,
} from '../scene';
import {
  runCncCompilationTask,
  type CncCompilationTaskResult,
  type PreparedCncCompilationArtifact,
} from './cnc-compilation-artifact';
import {
  compileCncJob,
  finalizeCncCompilationArtifact,
  prepareBoundCncCompilation,
} from './compile-cnc-job';

const COLOR = '#ff0000';
const VBIT: CncTool = {
  id: 'v90',
  name: '90 degree V-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 90,
};
const MACHINE: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  tools: [VBIT],
  toolId: VBIT.id,
};

function box(x: number, y: number, size = 10): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

function textObject(id: string, x: number): TextObject {
  return {
    kind: 'text',
    id,
    content: id,
    fontKey: 'pacifico-regular',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: COLOR,
    bounds: { minX: x, minY: 20, maxX: x + 16, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    // Each object's overlapping glyph contours must union before the two
    // objects enter the layer-wide even-odd normalization pool.
    paths: [{ color: COLOR, polylines: [box(x, 20), box(x + 6, 20)] }],
  };
}

function multiObjectScene(): Scene {
  return {
    objects: [textObject('first', 20), textObject('second', 60)],
    layers: [
      {
        ...createLayer({ id: 'vcarve-layer', color: COLOR }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'v-carve',
          toolId: VBIT.id,
          depthMm: 2,
          depthPerPassMm: 2,
          vCarveFlatDepthEnabled: true,
          vResolutionMm: 0.5,
        },
      },
    ],
  };
}

function prepare(compilationId: string): PreparedCncCompilationArtifact {
  return prepareBoundCncCompilation(
    { jobId: 'fixture-job', compilationId },
    multiObjectScene(),
    DEFAULT_DEVICE_PROFILE,
    MACHINE,
  );
}

function resultsFor(artifact: PreparedCncCompilationArtifact): CncCompilationTaskResult[] {
  return artifact.tasks.map((task) => ({
    jobId: artifact.identity.compilationId,
    taskId: task.taskId,
    result: runCncCompilationTask(task.payload),
  }));
}

function expectRejected(
  artifact: PreparedCncCompilationArtifact,
  results: ReadonlyArray<CncCompilationTaskResult>,
  reason: string,
): void {
  expect(finalizeCncCompilationArtifact(artifact, results)).toEqual({ kind: 'rejected', reason });
}

describe('bound CNC compilation artifact', () => {
  it('rejects a structurally similar value that lacks the private artifact binding', () => {
    const forged = {
      identity: { jobId: 'forged', compilationId: 'forged' },
      tasks: [],
    } as unknown as PreparedCncCompilationArtifact;

    expectRejected(forged, [], 'unknown-artifact');
  });

  it('matches the synchronous Job and G-code after out-of-order region completion', () => {
    const artifact = prepare('parallel-equivalence');
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(Object.isFrozen(artifact.tasks[0]?.payload.binding)).toBe(true);
    expect(artifact.tasks.map((task) => task.taskId)).toEqual(['vcarve:0:0', 'vcarve:0:1']);

    const finalized = finalizeCncCompilationArtifact(artifact, resultsFor(artifact).reverse());
    expect(finalized.kind).toBe('compiled');
    if (finalized.kind !== 'compiled') throw new Error(finalized.reason);
    const serial = compileCncJob(multiObjectScene(), DEFAULT_DEVICE_PROFILE, MACHINE);

    expect(finalized.job).toEqual(serial);
    expect(cncGrblStrategy.emit(finalized.job, DEFAULT_DEVICE_PROFILE)).toBe(
      cncGrblStrategy.emit(serial, DEFAULT_DEVICE_PROFILE),
    );
    expect(finalized.evidence.vcarveLayers).toHaveLength(1);
    expect(finalized.evidence.vcarveLayers[0]?.taskIds).toEqual(['vcarve:0:0', 'vcarve:0:1']);
    expect(finalized.evidence.vcarveLayers[0]?.ladder.passes).not.toHaveLength(0);
    expect(finalized.job.cncCompilation).toEqual(serial.cncCompilation);
    expect(finalized.job.cncCompilation?.vcarveOperations).toEqual([
      {
        operationIndex: 0,
        layerId: 'vcarve-layer',
        entryIssue: null,
        offsetFailed: false,
        thinResidual: false,
        passLimited: false,
      },
    ]);
    expect(structuredClone(finalized.job.cncCompilation)).toEqual(finalized.job.cncCompilation);
    expect(applyJobOriginOffset(finalized.job, { x: 3, y: 4 }).cncCompilation).toEqual(
      finalized.job.cncCompilation,
    );
    expect(optimizePaths(finalized.job).cncCompilation).toEqual(finalized.job.cncCompilation);
  });

  it('keeps task IDs stable while the caller-owned compile identity changes', () => {
    const first = prepare('identity-a');
    const second = prepare('identity-b');

    expect(second.tasks.map((task) => task.taskId)).toEqual(first.tasks.map((task) => task.taskId));
    expect(second.identity.compilationId).not.toBe(first.identity.compilationId);
  });

  it('rejects incomplete, stale, unknown, duplicate, and misbound result sets', () => {
    const artifact = prepare('validation-target');
    const results = resultsFor(artifact);
    const first = results[0];
    const second = results[1];
    if (first === undefined || second === undefined) throw new Error('fixture needs two tasks');

    expectRejected(artifact, results.slice(0, 1), 'incomplete-results');
    expectRejected(
      artifact,
      results.map((result) => ({ ...result, jobId: 'stale-compilation' })),
      'job-mismatch',
    );
    expectRejected(artifact, [{ ...first, taskId: 'unknown-task' }, second], 'unknown-task');
    expectRejected(artifact, [first, { ...first }], 'duplicate-task');
    expectRejected(artifact, [{ ...first, taskId: second.taskId }, second], 'task-result-mismatch');
    expectRejected(
      artifact,
      [
        {
          ...first,
          result: {
            ...first.result,
            regionResult: {
              ...first.result.regionResult,
              normalizedIndex: first.result.regionResult.normalizedIndex + 1,
            },
          },
        },
        second,
      ],
      'task-result-mismatch',
    );
  });

  it('rejects results from another artifact even when its relative task IDs match', () => {
    const current = prepare('current');
    const stale = prepare('stale');

    expectRejected(current, resultsFor(stale), 'job-mismatch');
  });

  it('retains a complete empty ladder for an all-open V-carve layer', () => {
    const scene = multiObjectScene();
    const first = scene.objects[0];
    if (first?.kind !== 'text') throw new Error('fixture text is missing');
    const open: Polyline = {
      closed: false,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ],
    };
    const openScene = {
      ...scene,
      objects: [{ ...first, paths: [{ color: COLOR, polylines: [open] }] }],
    };
    const artifact = prepareBoundCncCompilation(
      { jobId: 'open', compilationId: 'open-only' },
      openScene,
      DEFAULT_DEVICE_PROFILE,
      MACHINE,
    );

    expect(artifact.tasks).toEqual([]);
    const finalized = finalizeCncCompilationArtifact(artifact, []);
    expect(finalized.kind).toBe('compiled');
    if (finalized.kind !== 'compiled') throw new Error(finalized.reason);
    expect(finalized.job.groups).toEqual([]);
    expect(finalized.evidence.vcarveLayers[0]?.ladder).toMatchObject({
      passes: [],
      offsetFailed: false,
      entryIssue: null,
      thinResidual: false,
      passLimited: false,
    });
    expect(finalized.job.cncCompilation?.vcarveOperations).toEqual([
      {
        operationIndex: 0,
        layerId: 'vcarve-layer',
        entryIssue: null,
        offsetFailed: false,
        thinResidual: false,
        passLimited: false,
      },
    ]);
  });
});
