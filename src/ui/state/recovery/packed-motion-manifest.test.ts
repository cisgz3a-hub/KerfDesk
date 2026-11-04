import { describe, expect, it } from 'vitest';
import { buildMotionManifest, type MotionManifest } from '../../../core/job/motion-manifest';
import {
  decodeExecutionArtifactExport,
  serializeExecutionArtifactExport,
} from '../../laser/execution-artifact-export-codec';
import type { CanvasMotionPlan } from '../canvas-motion-plan';
import { isCurrentExecutionArtifact, type ExecutionArtifactV1 } from './execution-artifact';
import {
  archiveCanvasMotionPlan,
  executionArtifactCanvasPlan,
  transferredCanvasMotionPlan,
} from './execution-artifact-canvas';
import { executionArtifactIntegrityIsValid } from './execution-artifact-integrity';
import { MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES } from './execution-artifact-size';
import {
  isPackedMotionManifest,
  packedManifestTransferables,
  packedMotionManifestBytes,
  packMotionManifest,
  unpackMotionManifest,
  type PackedMotionManifest,
} from './packed-motion-manifest';
import { createCurrentTestExecutionArtifact } from './testing/execution-artifact-test-fixture';

const GCODE =
  'G21\nG90\nG0 X1.125 Y2.25\nM4 S100\nN12 G1 X3.125\nN13 G3 X1.125 I-1\nM5\nG0 X0 Y0\n';

describe('packed motion manifest columns', () => {
  it('pack the parser columns without copying and round-trip every block through clone', () => {
    const manifest = buildMotionManifest(GCODE, { machineKind: 'laser' });
    const packed = packMotionManifest(manifest);
    expect(packed.columns).toBe((manifest.blocks as unknown as { data: unknown }).data);
    const cloned = structuredClone(packed);
    expect(isPackedMotionManifest(cloned)).toBe(true);
    const unpacked = unpackMotionManifest(cloned);
    expect(Array.from(unpacked.blocks)).toEqual(Array.from(manifest.blocks));
    expect(unpacked.blocks.at(1)?.programLineNumber).toBe(12);
    expect(packedMotionManifestBytes(manifest)).toBeLessThan(400);
  });

  it('move to another thread by transfer, leaving nothing behind', () => {
    const manifest = buildMotionManifest(RASTER, { machineKind: 'laser' });
    const plan = archiveCanvasMotionPlan({ retentionKey: 'k', manifest } as CanvasMotionPlan, {
      enforceArchiveBudget: false,
    });
    const packed = plan.manifest as PackedMotionManifest;
    const moved = structuredClone(plan, { transfer: packedManifestTransferables(packed) });
    expect(packed.columns.x.length).toBe(0); // detached here
    const received = transferredCanvasMotionPlan(moved);
    expect(Array.from(received.manifest.blocks)).toEqual(
      Array.from(buildMotionManifest(RASTER, { machineKind: 'laser' }).blocks),
    );
  });

  it('keep a small plan in plain blocks, as before columns', () => {
    const manifest = buildMotionManifest(GCODE, { machineKind: 'laser' });
    const plan = archiveCanvasMotionPlan({ retentionKey: 'k', manifest } as CanvasMotionPlan);
    const kept = plan.manifest as MotionManifest;
    expect(Array.isArray(kept.blocks)).toBe(true);
    expect(kept.blocks).toEqual(Array.from(manifest.blocks));
  });

  it('pack blocks held as objects into the same columns', () => {
    const manifest = buildMotionManifest(GCODE, { machineKind: 'laser' });
    const objects = { ...manifest, blocks: Array.from(manifest.blocks) };
    const packed = packMotionManifest(objects);
    expect(packedMotionManifestBytes(objects)).toBe(packedMotionManifestBytes(manifest));
    expect(Array.from(unpackMotionManifest(packed).blocks)).toEqual(objects.blocks);
  });

  it.each([
    ['a wrong encoding tag', (packed: PackedMotionManifest) => ({ ...packed, encoding: 'x' })],
    [
      'a route total off its blocks',
      (packed: PackedMotionManifest) => ({ ...packed, totalRouteMm: 1 }),
    ],
    [
      'a sendable index past the program',
      (packed: PackedMotionManifest) => ({ ...packed, sendableLineCount: 2 }),
    ],
    [
      'truncated points',
      (packed: PackedMotionManifest) => ({
        ...packed,
        columns: { ...packed.columns, x: packed.columns.x.slice(1) },
      }),
    ],
  ] as const)('reject %s before expanding or selecting a path', (_name, corrupt) => {
    const packed = structuredClone(
      packMotionManifest(buildMotionManifest(GCODE, { machineKind: 'laser' })),
    );
    const invalid = corrupt(packed) as PackedMotionManifest;
    expect(isPackedMotionManifest(invalid)).toBe(false);
    expect(() => unpackMotionManifest(invalid)).toThrow('archived motion manifest is invalid');
  });

  it('reject motion indices outside the exact archived source and missing encoding tags', async () => {
    const { artifact } = await packedArtifact();
    const packed = artifact.canvasPlan.manifest;
    if (!isPackedMotionManifest(packed)) throw new Error('Expected packed archive.');
    packed.columns.rawLine[packed.columns.count - 1] = artifact.fingerprint.lines;
    expect(isCurrentExecutionArtifact(artifact)).toBe(false);
    const { encoding, ...withoutTag } = packed;
    void encoding;
    expect(
      isCurrentExecutionArtifact({
        ...artifact,
        canvasPlan: { ...artifact.canvasPlan, manifest: withoutTag },
      }),
    ).toBe(false);
  });

  it('round-trip through the verified binary export codec', async () => {
    const { artifact, plan } = await packedArtifact();
    const serialized = await serializeExecutionArtifactExport(artifact);
    const decoded = await decodeExecutionArtifactExport(serialized);
    expect(isPackedMotionManifest(decoded.canvasPlan.manifest)).toBe(true);
    const reopened = executionArtifactCanvasPlan(decoded);
    expect(Array.from(reopened.manifest.blocks)).toEqual(Array.from(plan.manifest.blocks));
    expect(decoded.gcode).toBe(artifact.gcode);
    expect(await executionArtifactIntegrityIsValid(decoded)).toBe(true);
    expect(decoded.estimatedArtifactBytes).toBeLessThan(MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES);
  });
});

/** Past the 4,096 blocks from which a plan is packed. */
const RASTER = `G21\nG90\nM4 S100\n${Array.from({ length: 4_100 }, (_, index) => `G1 X${(index % 2) + 1} Y1`).join('\n')}\nM5\n`;

async function packedArtifact(): Promise<{
  readonly artifact: ExecutionArtifactV1;
  readonly plan: CanvasMotionPlan;
}> {
  const gcode = RASTER;
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
