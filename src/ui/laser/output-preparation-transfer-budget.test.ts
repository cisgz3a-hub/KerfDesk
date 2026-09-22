// A Start preparation is packed for the worker-to-main handoff (ADR-345). That
// packing must never apply the ARCHIVE budget: the archive is written later and
// is best-effort, so refusing here would make a large job unpreparable — a
// size-based Start refusal of exactly the kind ADR-241/243/244 removed.
import { describe, expect, it } from 'vitest';
import type { MotionManifest, MotionPoint } from '../../core/job/motion-manifest';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { archiveCanvasMotionPlan } from '../state/recovery/execution-artifact-canvas';
import {
  packedMotionManifestBytes,
  PACKED_POINT_WIDTH,
} from '../state/recovery/packed-motion-manifest';
import { MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES } from '../state/recovery/execution-artifact-size';

/** A manifest whose packed encoding is provably past the archive budget. */
function oversizedManifest(): MotionManifest {
  const pointsPerBlock = 64;
  const bytesPerBlock = (10 + pointsPerBlock * PACKED_POINT_WIDTH) * Float64Array.BYTES_PER_ELEMENT;
  const blockCount = Math.ceil(MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES / bytesPerBlock) + 1;
  const points: MotionPoint[] = Array.from({ length: pointsPerBlock }, (_unused, index) => ({
    x: index,
    y: 0,
    z: 0,
  }));
  const blocks = Array.from({ length: blockCount }, (_unused, index) => ({
    rawLineIndex: index,
    sendableLineIndex: index,
    programLineNumber: null,
    kind: 'process' as const,
    points,
    lengthMm: 1,
    routeStartMm: index,
    routeEndMm: index + 1,
  }));
  return {
    blocks,
    totalRouteMm: blockCount,
    sendableLineCount: blockCount,
    firstProcessPoint: points[0] ?? null,
    finalPoint: points[points.length - 1] ?? null,
  };
}

function planFor(manifest: MotionManifest): CanvasMotionPlan {
  return { manifest } as unknown as CanvasMotionPlan;
}

describe('packing a Start preparation for the worker handoff', () => {
  it('packs a manifest past the archive budget instead of refusing it', () => {
    const manifest = oversizedManifest();
    expect(packedMotionManifestBytes(manifest)).toBeGreaterThan(
      MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES,
    );

    const transferred = archiveCanvasMotionPlan(planFor(manifest), {
      enforceArchiveBudget: false,
    });

    expect(transferred.manifest).not.toBe(manifest);
    expect(transferred.manifest).toHaveProperty('encoding');
  });

  it('still refuses the same manifest when it is genuinely being archived', () => {
    expect(() => archiveCanvasMotionPlan(planFor(oversizedManifest()))).toThrow(
      'Execution artifact exceeds the safe archive size.',
    );
  });
});
