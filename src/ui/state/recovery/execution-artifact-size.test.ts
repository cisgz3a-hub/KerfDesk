import { describe, expect, it } from 'vitest';
import {
  assertExecutionArtifactSizeWithinBudget,
  estimateExecutionArtifactBytes,
  measureExecutionArtifactBytesWithinBudget,
  memoizedExecutionArtifactBytes,
  MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES,
} from './execution-artifact-size';

/** A graph shaped like the part of an artifact that dominates the traversal:
 * one node per motion-manifest point. */
function motionShapedArtifact(points: number): Record<string, unknown> {
  const blocks = [];
  for (let block = 0; block * 64 < points; block += 1) {
    const blockPoints = [];
    for (let point = 0; point < 64; point += 1) {
      blockPoints.push({ x: point * 0.01, y: block * 0.1, z: 0 });
    }
    blocks.push({ kind: 'process', points: blockPoints, lengthMm: 1 });
  }
  return {
    gcode: 'G21\nG90\nG1 X1 Y1\nM5\n',
    canvasPlan: { manifest: { blocks, sendableLineCount: points } },
    prepared: { project: { device: { name: 'Test' } }, job: { groups: [] } },
  };
}

describe('execution artifact size measurement', () => {
  it('returns the same total the standalone estimate produces', () => {
    const artifact = motionShapedArtifact(512);
    expect(measureExecutionArtifactBytesWithinBudget(artifact)).toBe(
      estimateExecutionArtifactBytes(artifact),
    );
  });

  it('returns a complete total rather than the early-exit lower bound', () => {
    const artifact = motionShapedArtifact(512);
    const measured = measureExecutionArtifactBytesWithinBudget(artifact);
    // A walk that stopped at the budget would report at most the budget.
    expect(measured).toBeLessThan(MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES);
    expect(measured).toBe(estimateExecutionArtifactBytes(artifact, Number.MAX_SAFE_INTEGER));
  });

  it('throws on an over-budget value exactly as the assertion does', () => {
    const oversized = { buffer: new Uint8Array(MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES + 1) };
    expect(() => measureExecutionArtifactBytesWithinBudget(oversized)).toThrow(
      'Execution artifact exceeds the safe archive size.',
    );
    expect(() => assertExecutionArtifactSizeWithinBudget(oversized)).toThrow(
      'Execution artifact exceeds the safe archive size.',
    );
  });

  it('rejects a binary allowance that alone exceeds the budget', () => {
    expect(() =>
      measureExecutionArtifactBytesWithinBudget({}, MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES + 1),
    ).toThrow('Execution artifact exceeds the safe archive size.');
  });

  it('memoizes on artifact identity without changing the reported size', () => {
    const artifact = motionShapedArtifact(256);
    const expected = estimateExecutionArtifactBytes(artifact);
    expect(memoizedExecutionArtifactBytes(artifact)).toBe(expected);
    expect(memoizedExecutionArtifactBytes(artifact)).toBe(expected);
    // A structurally identical but distinct object is measured on its own.
    expect(memoizedExecutionArtifactBytes(motionShapedArtifact(256))).toBe(expected);
  });
});
