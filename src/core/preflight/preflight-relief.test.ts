// Relief-specific preflight behavior (ADR-101 §8 follow-up): a relief-only
// laser scene must fail with a NAMED issue, not the generic empty-output
// internal error. Split from preflight.test.ts, which is at the size cap
// (preflight-raster.test.ts precedent).

import { describe, expect, it } from 'vitest';
import { compileJob } from '../job';
import { grblStrategy } from '../output';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
} from '../scene';
import { runPreflight } from './preflight';

function emit(project: Project): string {
  return grblStrategy.emit(compileJob(project.scene, project.device), project.device);
}

function reliefOnlyProject(layerPatch: Partial<ReturnType<typeof createLayer>> = {}): Project {
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'R1',
    source: 'model.stl',
    meshPositions: [0, 0, 0, 10, 0, 0, 0, 10, 5],
    targetWidthMm: 100,
    reliefDepthMm: 5,
    emptyCells: 'floor',
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
  };
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [relief],
      layers: [{ ...createLayer({ id: '#a0522d', color: '#a0522d' }), ...layerPatch }],
    },
  };
}

describe('runPreflight relief-needs-cnc', () => {
  it('names relief-needs-cnc when the empty compile is a relief-only laser scene', () => {
    const project = reliefOnlyProject();

    const result = runPreflight(project, emit(project));

    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain('relief-needs-cnc');
    expect(codes).not.toContain('empty-output');
    const issue = result.issues.find((candidate) => candidate.code === 'relief-needs-cnc');
    expect(issue?.message).toContain('CNC mode');
  });

  it('keeps the generic empty-output error when the relief layer has output off', () => {
    const project = reliefOnlyProject({ output: false });

    const result = runPreflight(project, emit(project));

    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain('empty-output');
    expect(codes).not.toContain('relief-needs-cnc');
  });
});
