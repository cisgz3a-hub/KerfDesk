import { describe, expect, it } from 'vitest';
import {
  assertExecutionArtifactSizeWithinBudget,
  estimateExecutionArtifactBytes,
  measureExecutionArtifactBytesWithinBudget,
  memoizedExecutionArtifactBytes,
  MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES,
  stringBytes,
} from './execution-artifact-size';

describe('string storage estimate', () => {
  it('counts an all-ASCII string at one byte per character', () => {
    expect(stringBytes('')).toBe(0);
    expect(stringBytes('G1X12.5S300\n')).toBe(12);
    expect(stringBytes('\u0000\u007f')).toBe(2);
  });

  it('keeps the UTF-8 maximum for any string with a wider code unit', () => {
    expect(stringBytes('°')).toBe(3);
    expect(stringBytes('G1 ; 10 mm²')).toBe(33);
    expect(stringBytes('😀')).toBe(6);
  });

  it('archives a 25 million character program that the old three-byte rule refused', () => {
    const gcode = 'X12.345S678\n'.repeat(Math.ceil(25_000_000 / 12));
    expect(gcode.length * 3).toBeGreaterThan(MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES);
    const measured = measureExecutionArtifactBytesWithinBudget({ gcode });
    expect(measured).toBeGreaterThanOrEqual(gcode.length);
    expect(measured).toBeLessThan(gcode.length + 256);
  });
});

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
