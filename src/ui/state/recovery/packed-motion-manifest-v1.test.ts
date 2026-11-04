import { describe, expect, it } from 'vitest';
import { buildMotionManifest } from '../../../core/job/motion-manifest';
import type { CanvasMotionPlan } from '../canvas-motion-plan';
import {
  executionArtifactCanvasPlan,
  isArchivedCanvasMotionPlan,
} from './execution-artifact-canvas';
import {
  isLegacyPackedMotionManifest,
  packLegacyMotionManifest,
  unpackLegacyMotionManifest,
  type LegacyPackedMotionManifest,
} from './packed-motion-manifest-v1';

// Recovery archives written before ADR-244 Amendment 3 hold this encoding.
const GCODE =
  'G21\nG90\nG0 X1.125 Y2.25\nM4 S100\nN12 G1 X3.125\nN13 G3 X1.125 I-1\nM5\nG0 X0 Y0\n';

describe('legacy packed motion manifests', () => {
  it('still read back every line, kind, double-precision point and route distance', () => {
    const manifest = buildMotionManifest(GCODE, { machineKind: 'laser' });
    expect(Array.from(manifest.blocks).some((block) => block.points.length > 2)).toBe(true);
    const cloned = structuredClone(packLegacyMotionManifest(manifest));
    expect(isLegacyPackedMotionManifest(cloned)).toBe(true);
    const unpacked = unpackLegacyMotionManifest(cloned);
    expect(Array.from(unpacked.blocks)).toEqual(Array.from(manifest.blocks));
    expect(unpacked.blocks.at(1)?.programLineNumber).toBe(12);
  });

  it('opens an archived canvas plan that holds the legacy encoding', () => {
    const manifest = buildMotionManifest(GCODE, { machineKind: 'laser' });
    const archived = {
      retentionKey: 'legacy',
      manifest: structuredClone(packLegacyMotionManifest(manifest)),
    } as unknown as CanvasMotionPlan;
    expect(isArchivedCanvasMotionPlan(archived, 9, manifest.sendableLineCount)).toBe(true);
    const plan = executionArtifactCanvasPlan({ canvasPlan: archived });
    expect(Array.from(plan.manifest.blocks)).toEqual(Array.from(manifest.blocks));
  });

  it.each([
    [
      'truncated block',
      (packed: LegacyPackedMotionManifest) => ({ ...packed, blockData: packed.blockData.slice(1) }),
    ],
    [
      'truncated points',
      (packed: LegacyPackedMotionManifest) => ({ ...packed, pointData: packed.pointData.slice(3) }),
    ],
    [
      'non-finite point',
      (packed: LegacyPackedMotionManifest) => {
        packed.pointData[0] = Infinity;
        return packed;
      },
    ],
    [
      'non-finite metadata',
      (packed: LegacyPackedMotionManifest) => {
        packed.blockData[7] = NaN;
        return packed;
      },
    ],
    [
      'invalid raw line',
      (packed: LegacyPackedMotionManifest) => {
        packed.blockData[0] = -1;
        return packed;
      },
    ],
    [
      'unordered raw lines',
      (packed: LegacyPackedMotionManifest) => {
        packed.blockData[10] = packed.blockData[0] ?? 0;
        return packed;
      },
    ],
    [
      'unordered sendable lines',
      (packed: LegacyPackedMotionManifest) => {
        packed.blockData[11] = packed.blockData[1] ?? 0;
        return packed;
      },
    ],
    [
      'invalid point offset',
      (packed: LegacyPackedMotionManifest) => {
        packed.blockData[3] = 1;
        return packed;
      },
    ],
    [
      'invalid route distance',
      (packed: LegacyPackedMotionManifest) => {
        packed.blockData[9] = 10;
        return packed;
      },
    ],
  ] as const)('rejects %s before expanding or selecting a path', (_name, corrupt) => {
    const packed = packLegacyMotionManifest(buildMotionManifest(GCODE, { machineKind: 'laser' }));
    const invalid = corrupt(packed);
    expect(isLegacyPackedMotionManifest(invalid)).toBe(false);
    expect(() => unpackLegacyMotionManifest(invalid)).toThrow(
      'archived motion manifest is invalid',
    );
  });
});
