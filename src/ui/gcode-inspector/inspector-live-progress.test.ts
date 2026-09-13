import { describe, expect, it } from 'vitest';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { inspectorPlayheadAtRoute } from './inspector-live-progress';
import { liveInspectorModel, liveInspectorRun } from './inspector-live-test-fixture';

describe('confirmed Inspector route', () => {
  it('maps raw source lines despite blank/comment lines and interpolates a move', () => {
    const run = liveInspectorRun();
    const playhead = inspectorPlayheadAtRoute(liveInspectorModel(), run.plan.manifest, 5);
    expect(playhead).toMatchObject({
      segmentIndex: 0,
      segmentFraction: 0.5,
      point: { x: 5, y: 0, z: 0 },
    });
    expect(liveInspectorModel().segLine[playhead?.segmentIndex ?? -1]).toBe(4);
  });

  it('follows tessellated helical arcs through the same source line', () => {
    const source = 'G21 G90\nG0 X10 Y0\nG3 X0 Y10 Z-2 I-10 J0 F300';
    const model = liveInspectorModel(source);
    const manifest = buildMotionManifest(source, { machineKind: 'cnc' });
    const arc = manifest.blocks[1];
    if (arc === undefined) throw new Error('Expected arc');
    const at = inspectorPlayheadAtRoute(model, manifest, arc.routeStartMm + arc.lengthMm / 2);
    expect(at?.point?.x).toBeCloseTo(7.07, 1);
    expect(at?.point?.y).toBeCloseTo(7.07, 1);
    expect(at?.point?.z).toBeCloseTo(-1, 3);
    expect(model.segLine[at?.segmentIndex ?? -1]).toBe(2);
  });

  it('keeps a runtime-seeded approach from being projected onto a different preview move', () => {
    const source = 'G21 G90\nG0 X10\nG1 X20 F600';
    const model = liveInspectorModel(source);
    const manifest = buildMotionManifest(source, {
      machineKind: 'laser',
      initialPosition: { x: 5, y: 0, z: 0 },
    });
    expect(inspectorPlayheadAtRoute(model, manifest, 2)).toBeNull();
    expect(inspectorPlayheadAtRoute(model, manifest, 10)?.point).toEqual({ x: 15, y: 0, z: 0 });
  });

  it('clamps completed progress to the last vertex and rejects non-finite input', () => {
    const model = liveInspectorModel();
    const { manifest } = liveInspectorRun().plan;
    expect(inspectorPlayheadAtRoute(model, manifest, 100)?.point).toEqual({ x: 10, y: 10, z: 0 });
    expect(inspectorPlayheadAtRoute(model, manifest, NaN)).toBeNull();
  });
});
