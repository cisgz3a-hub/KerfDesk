import { describe, expect, it } from 'vitest';
import type { MotionManifest } from '../../../core/job/motion-manifest';
import { MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES } from '../../state/recovery/execution-artifact-size';
import { packedMotionManifestBytes } from '../../state/recovery/packed-motion-manifest';
import { detectArchiveCapacityWarnings } from './archive-capacity-warnings';

function manifestWithPoints(points: number): MotionManifest {
  return {
    blocks: [{ points: Array.from({ length: points }, (_, index) => ({ x: index, y: 0 })) }],
  } as unknown as MotionManifest;
}

describe('recovery archive capacity warning in Job Review', () => {
  it('stays silent for a job whose program and motion data fit the archive', () => {
    const prepared = {
      gcode: 'G21\nG90\nG1 X10 S100\nM5\n',
      canvasPlan: { manifest: manifestWithPoints(4) },
    };
    expect(detectArchiveCapacityWarnings(prepared)).toEqual([]);
  });

  it('explains before Start that an oversized job keeps no recovery copy', () => {
    const manifest = manifestWithPoints(1000);
    const gcodeLength =
      MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES - packedMotionManifestBytes(manifest) + 1;
    const warnings = detectArchiveCapacityWarnings({
      gcode: 'X'.repeat(gcodeLength),
      canvasPlan: { manifest },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('too large to keep a recovery copy');
    expect(warnings[0]).toContain('at most 64 MB');
    expect(warnings[0]).toContain('cannot be resumed from a saved copy');
  });

  it('agrees with the archive limit exactly at the boundary', () => {
    const manifest = manifestWithPoints(10);
    const fits = MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES - packedMotionManifestBytes(manifest);
    expect(
      detectArchiveCapacityWarnings({ gcode: 'X'.repeat(fits), canvasPlan: { manifest } }),
    ).toEqual([]);
  });
});
