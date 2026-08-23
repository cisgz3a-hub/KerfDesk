import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReliefRoughingModule from '../relief/relief-roughing';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { applyJobOriginOffset, optimizePaths, type CncPass } from '../job';
import { cncGrblStrategy } from '../output';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type ReliefObject,
  type Scene,
} from '../scene';

const roughingLadder = vi.hoisted(() => vi.fn());

vi.mock('../relief/relief-roughing', async (importOriginal) => ({
  ...(await importOriginal<typeof ReliefRoughingModule>()),
  reliefRoughingLadder: roughingLadder,
}));

const { compileCncJob, finalizeCncCompilationArtifact, prepareBoundCncCompilation } =
  await import('./compile-cnc-job');

const RELIEF_PASS: CncPass = {
  kind: 'contour',
  zMm: -1,
  closed: true,
  polyline: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 0, y: 0 },
  ],
};

beforeEach(() => {
  roughingLadder.mockReset();
  roughingLadder.mockReturnValue({
    passes: [RELIEF_PASS],
    offsetFailed: false,
    passLimited: false,
  });
});

describe('compiled relief roughing evidence', () => {
  it('retains authoritative empty diagnostics in a relief-only Job sidecar', () => {
    const job = compileCncJob(reliefScene(), DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);

    expect(job.cncCompilation?.vcarveOperations).toEqual([]);
    expect(job.cncCompilation?.offsetLadderDiagnostics).toEqual([]);
  });

  it('uses the exact compiling ladder and keeps sidecar evidence out of G-code bytes', () => {
    roughingLadder.mockReturnValue({
      passes: [RELIEF_PASS],
      offsetFailed: true,
      passLimited: true,
    });

    const job = compileCncJob(reliefScene(), DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
    const withoutEvidence = { groups: job.groups };

    expect(job.cncCompilation?.offsetLadderDiagnostics).toEqual([
      { layerId: 'relief-layer', kind: 'geometry-failed' },
      { layerId: 'relief-layer', kind: 'relief-pass-limit' },
    ]);
    expect(roughingLadder).toHaveBeenCalledTimes(1);
    expect(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE)).toBe(
      cncGrblStrategy.emit(withoutEvidence, DEFAULT_DEVICE_PROFILE),
    );
    expect(structuredClone(job.cncCompilation)).toEqual(job.cncCompilation);
    expect(applyJobOriginOffset(job, { x: 3, y: 4 }).cncCompilation).toEqual(job.cncCompilation);
    expect(optimizePaths(job).cncCompilation).toEqual(job.cncCompilation);
  });

  it('matches synchronous and artifact-finalized relief evidence', () => {
    const scene = reliefScene();
    const serial = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
    const artifact = prepareBoundCncCompilation(
      { jobId: 'relief', compilationId: 'relief-evidence' },
      scene,
      DEFAULT_DEVICE_PROFILE,
      DEFAULT_CNC_MACHINE_CONFIG,
    );

    const finalized = finalizeCncCompilationArtifact(artifact, []);

    expect(finalized.kind).toBe('compiled');
    if (finalized.kind !== 'compiled') throw new Error(finalized.reason);
    expect(finalized.job).toEqual(serial);
  });
});

function reliefScene(): Scene {
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'relief',
    source: 'relief.stl',
    targetWidthMm: 10,
    reliefDepthMm: 2,
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: [0, 0, 0, 10, 0, 0, 10, 10, 1, 0, 0, 0, 10, 10, 1, 0, 10, 0],
      emptyCells: 'floor',
    },
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
  };
  return {
    objects: [relief],
    layers: [
      {
        ...createLayer({ id: 'relief-layer', name: 'Relief', color: relief.color }),
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthPerPassMm: 1 },
      },
    ],
  };
}
