import { describe, expect, it } from 'vitest';
import { buildMotionManifest, type MotionBlock } from '../../../core/job/motion-manifest';
import type { CanvasMotionPlan } from '../canvas-motion-plan';
import { archiveCanvasMotionPlan, executionArtifactCanvasPlan } from './execution-artifact-canvas';
import {
  estimateExecutionArtifactBytes,
  MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES,
} from './execution-artifact-size';

describe('sampled arc archive compaction', () => {
  it('packs a large sampled route even when it has fewer than 4096 G-code movements', () => {
    // Circle fitting makes a compact source program, but each 200 mm-radius
    // circle has 142 sampled preview points. Source block count is insufficient
    // to predict archive size. Every circle stays inside a 400 mm square bed.
    const gcode = 'G21\nG90\nG0 X0 Y200\nM4 S300\n' + 'G2 X0 Y200 I200 J0\n'.repeat(3_500) + 'M5\n';
    const manifest = buildMotionManifest(gcode, { machineKind: 'laser' });
    expect(manifest.blocks.length).toBeLessThan(4_096);
    expect(estimateExecutionArtifactBytes(manifest)).toBeGreaterThan(
      MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES,
    );
    const source = { manifest, retentionKey: 'sampled-arcs' } as CanvasMotionPlan;

    const archived = archiveCanvasMotionPlan(source);

    expect(estimateExecutionArtifactBytes(archived)).toBeLessThan(
      MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES,
    );
    const restored = executionArtifactCanvasPlan({ canvasPlan: structuredClone(archived) });
    expect(restored.manifest.blocks.length).toBe(manifest.blocks.length);
    expect(restored.manifest.totalRouteMm).toBe(manifest.totalRouteMm);
    for (let index = 0; index < manifest.blocks.length; index += 1) {
      const original = manifest.blocks[index];
      const decoded = restored.manifest.blocks[index];
      if (canonicalMovement(original) !== canonicalMovement(decoded)) {
        throw new Error(`Arc movement ${index} did not survive exact archive roundtrip.`);
      }
    }
  }, 30_000);
});

function canonicalMovement(block: MotionBlock | undefined): string {
  if (block === undefined) return 'missing';
  return JSON.stringify([
    block.rawLineIndex,
    block.sendableLineIndex,
    block.programLineNumber,
    block.kind,
    block.lengthMm,
    block.routeStartMm,
    block.routeEndMm,
    block.points.map((point) => [point.x, point.y, point.z]),
  ]);
}
