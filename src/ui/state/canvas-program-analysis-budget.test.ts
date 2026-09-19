import { describe, expect, it } from 'vitest';
import type { MotionManifest } from '../../core/job/motion-manifest';
import {
  canvasExecutableSidecarWithinBudget,
  canvasProgramExceedsLineBudget,
} from './canvas-program-analysis-budget';

describe('optional canvas program analysis budgets', () => {
  it.each(['\n', '\r\n', '\r'])(
    'counts complete source lines at the existing countdown boundary for %j',
    (newline) => {
      const atBudget = `;${newline}`.repeat(24_999);
      expect(canvasProgramExceedsLineBudget(atBudget)).toBe(false);
      expect(canvasProgramExceedsLineBudget(`${atBudget};${newline}`)).toBe(true);
    },
  );

  it('bounds repeated modal or comment lines even when the route is small', () => {
    expect(canvasExecutableSidecarWithinBudget('G21\n'.repeat(25_000), manifest(1))).toBe(false);
  });

  it('uses expanded segment count even when one block holds the whole route', () => {
    expect(canvasExecutableSidecarWithinBudget('G2 X0 I1', manifest(25_000))).toBe(true);
    expect(canvasExecutableSidecarWithinBudget('G2 X0 I1', manifest(25_001))).toBe(false);
  });
});

function manifest(segments: number): MotionManifest {
  const point = { x: 0, y: 0, z: 0 };
  return {
    blocks: [
      {
        rawLineIndex: 0,
        sendableLineIndex: 0,
        programLineNumber: null,
        kind: 'process',
        points: Array.from({ length: segments + 1 }, () => point),
        lengthMm: 1,
        routeStartMm: 0,
        routeEndMm: 1,
      },
    ],
    totalRouteMm: 1,
    sendableLineCount: 1,
    firstProcessPoint: point,
    finalPoint: point,
  };
}
