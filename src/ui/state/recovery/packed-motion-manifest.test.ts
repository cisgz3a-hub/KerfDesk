import { describe, expect, it } from 'vitest';
import { buildMotionManifest } from '../../../core/job/motion-manifest';
import {
  decodeExecutionArtifactExport,
  serializeExecutionArtifactExport,
} from '../../laser/execution-artifact-export-codec';
import type { CanvasMotionPlan } from '../canvas-motion-plan';
import { isCurrentExecutionArtifact, type ExecutionArtifactV1 } from './execution-artifact';
import { executionArtifactCanvasPlan } from './execution-artifact-canvas';
import { executionArtifactIntegrityIsValid } from './execution-artifact-integrity';
import { MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES } from './execution-artifact-size';
import {
  isPackedMotionManifest,
  packMotionManifest,
  unpackMotionManifest,
  type PackedMotionManifest,
} from './packed-motion-manifest';
import { createCurrentTestExecutionArtifact } from './testing/execution-artifact-test-fixture';

const GCODE =
  'G21\nG90\nG0 X1.125 Y2.25\nM4 S100\nN12 G1 X3.125\nN13 G3 X1.125 I-1\nM5\nG0 X0 Y0\n';

describe('packed archived motion manifests', () => {
  it('retains every original line, kind, double-precision point and route distance through clone', () => {
    const manifest = buildMotionManifest(GCODE, { machineKind: 'laser' });
    expect(manifest.blocks.some((block) => block.points.length > 2)).toBe(true);
    const packed = packMotionManifest(manifest);
    const cloned = structuredClone(packed);
    expect(isPackedMotionManifest(cloned)).toBe(true);
    expect(unpackMotionManifest(cloned)).toEqual(manifest);
    expect(manifest.blocks[0]?.programLineNumber).toBeNull();
    expect(manifest.blocks[1]?.programLineNumber).toBe(12);
  });

  it.each([
    [
      'truncated block',
      (packed: PackedMotionManifest) => ({ ...packed, blockData: packed.blockData.slice(1) }),
    ],
    [
      'truncated points',
      (packed: PackedMotionManifest) => ({ ...packed, pointData: packed.pointData.slice(3) }),
    ],
    [
      'non-finite point',
      (packed: PackedMotionManifest) => {
        packed.pointData[0] = Infinity;
        return packed;
      },
    ],
    [
      'non-finite metadata',
      (packed: PackedMotionManifest) => {
        packed.blockData[7] = NaN;
        return packed;
      },
    ],
    [
      'invalid raw line',
      (packed: PackedMotionManifest) => {
        packed.blockData[0] = -1;
        return packed;
      },
    ],
    [
      'unordered raw lines',
      (packed: PackedMotionManifest) => {
        packed.blockData[10] = packed.blockData[0] ?? 0;
        return packed;
      },
    ],
    [
      'unordered sendable lines',
      (packed: PackedMotionManifest) => {
        packed.blockData[11] = packed.blockData[1] ?? 0;
        return packed;
      },
    ],
    [
      'invalid point offset',
      (packed: PackedMotionManifest) => {
        packed.blockData[3] = 1;
        return packed;
      },
    ],
    [
      'invalid route distance',
      (packed: PackedMotionManifest) => {
        packed.blockData[9] = 10;
        return packed;
      },
    ],
  ] as const)('rejects %s before expanding or selecting a path', (_name, corrupt) => {
    const packed = packMotionManifest(buildMotionManifest(GCODE, { machineKind: 'laser' }));
    const invalid = corrupt(packed);
    expect(isPackedMotionManifest(invalid)).toBe(false);
    expect(() => unpackMotionManifest(invalid)).toThrow('archived motion manifest is invalid');
  });

  it('rejects motion indices outside the exact archived source and missing encoding tags', async () => {
    const { artifact } = await packedArtifact();
    const packed = artifact.canvasPlan.manifest;
    if (!isPackedMotionManifest(packed)) throw new Error('Expected packed archive.');
    packed.blockData[packed.blockData.length - 10] = artifact.fingerprint.lines;
    expect(isCurrentExecutionArtifact(artifact)).toBe(false);
    const missingTag = { ...packed, encoding: undefined };
    expect(
      isCurrentExecutionArtifact({
        ...artifact,
        canvasPlan: { ...artifact.canvasPlan, manifest: missingTag },
      }),
    ).toBe(false);
    const { encoding, ...withoutTag } = packed;
    void encoding;
    expect(
      isCurrentExecutionArtifact({
        ...artifact,
        canvasPlan: { ...artifact.canvasPlan, manifest: withoutTag },
      }),
    ).toBe(false);
  });

  it('round-trips packed Float64Array data through the verified binary export codec', async () => {
    const { artifact, plan } = await packedArtifact();
    const serialized = await serializeExecutionArtifactExport(artifact);
    const decoded = await decodeExecutionArtifactExport(serialized);
    expect(isPackedMotionManifest(decoded.canvasPlan.manifest)).toBe(true);
    expect(executionArtifactCanvasPlan(decoded)).toEqual(plan);
    expect(decoded.gcode).toBe(artifact.gcode);
    expect(await executionArtifactIntegrityIsValid(decoded)).toBe(true);
    expect(decoded.estimatedArtifactBytes).toBeLessThan(MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES);
  });
});

async function packedArtifact(): Promise<{
  readonly artifact: ExecutionArtifactV1;
  readonly plan: CanvasMotionPlan;
}> {
  const gcode = `G21\nG90\nM4 S100\n${Array.from({ length: 4_100 }, (_, index) => `G1 X${(index % 2) + 1} Y1`).join('\n')}\nM5\n`;
  const plan = {
    retentionKey: 'packed-fixture',
    manifest: buildMotionManifest(gcode, { machineKind: 'laser' }),
  } as CanvasMotionPlan;
  const artifact = await createCurrentTestExecutionArtifact({
    runId: 'packed-fixture',
    gcode,
    canvasPlan: plan,
  });
  return { artifact, plan };
}
