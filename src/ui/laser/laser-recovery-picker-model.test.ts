import { describe, expect, it } from 'vitest';
import { buildMotionManifest, type MotionBlock } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import { createProject } from '../../core/scene';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import {
  acknowledgedRecoveryMovement,
  firstRecoveryMovement,
  pickRecoveryMovement,
  recoveryPreviewBounds,
  recoveryPreviewPath,
  RECOVERY_PREVIEW_SEGMENT_LIMIT,
  zoomRecoveryPreview,
} from './laser-recovery-picker-model';

const RASTER = [
  '; original raw line numbering',
  'G21',
  'G90',
  'M4 S0',
  'G0 X10 Y20',
  'G1 X20 Y20 S300',
  'X30 S0',
  'X40 S600',
  'G0 X40 Y21 S0',
  'G1 X30 Y21 S300',
  'M5',
].join('\n');

describe('laser recovery route selection', () => {
  it('selects an original raw movement across comments, modal raster power and saved origin', () => {
    const plan = planFor(RASTER);
    const before = structuredClone(plan);
    expect(pickRecoveryMovement(plan, { x: 5, y: 0.05 }, 0.1, 1)).toBe(6);
    expect(pickRecoveryMovement(plan, { x: 15, y: 0 }, 0.1, 1)).toBeNull();
    expect(pickRecoveryMovement(plan, { x: 25, y: 1 }, 0.1, 1)).toBe(10);
    const reverse = firstRecoveryMovement(plan, 10);
    expect(reverse?.points[0]).toEqual({ x: 40, y: 21, z: 0 });
    expect(firstRecoveryMovement(plan, 7)?.rawLineIndex).toBe(7);
    expect(firstRecoveryMovement(plan, 11)).toBeNull();
    expect(acknowledgedRecoveryMovement(plan, 6)).toBe(8);
    expect(acknowledgedRecoveryMovement(plan, 7)).toBe(10);
    expect(plan).toEqual(before);
  });

  it('uses the saved physical mapping for mirrored device origins', () => {
    const base = planFor(RASTER);
    const plan: CanvasMotionPlan = {
      ...base,
      device: { ...base.device, origin: 'front-right', bedWidth: 100, bedHeight: 80 },
      coordinateFrame: { kind: 'machine', workOffsetMm: { x: 3, y: 4, z: 0 } },
    };
    expect(pickRecoveryMovement(plan, { x: 82, y: 56 }, 0.1, 1)).toBe(6);
  });

  it('disambiguates coincident passes by proximity to the selected transport line', () => {
    const plan = planFor('M4 S0\nG0 X10 Y20\nG1 X20 S400\nG0 X10 S0\nG1 X20 S400');
    expect(pickRecoveryMovement(plan, { x: 5, y: 0 }, 0.1, 3)).toBe(3);
    expect(pickRecoveryMovement(plan, { x: 5, y: 0 }, 0.1, 5)).toBe(5);
  });

  it('picks a curved movement from its archived arc geometry without splitting the source line', () => {
    const plan = planFor('M4 S0\nG0 X10 Y20\nG2 X20 Y20 I5 J0 S400');
    expect(pickRecoveryMovement(plan, { x: 5, y: 5 }, 0.1, 1)).toBe(3);
    expect(pickRecoveryMovement(plan, { x: 5, y: 0 }, 0.1, 1)).toBeNull();
    expect(firstRecoveryMovement(plan, 3)?.points[0]).toEqual({ x: 10, y: 20, z: 0 });
  });

  it('caps large raster display allocation while picking every saved row exactly', () => {
    const count = 25_000;
    const blocks: MotionBlock[] = Array.from({ length: count }, (_, row) => ({
      rawLineIndex: row + 10,
      sendableLineIndex: row + 5,
      programLineNumber: null,
      kind: 'process',
      points: [
        { x: 10, y: row + 20, z: 0 },
        { x: 30, y: row + 20, z: 0 },
      ],
      lengthMm: 20,
      routeStartMm: row * 20,
      routeEndMm: (row + 1) * 20,
    }));
    const base = planFor(RASTER);
    const plan = { ...base, manifest: { ...base.manifest, blocks } };
    const fit = recoveryPreviewBounds(plan);
    if (fit === null) throw new Error('Expected a finite preview.');
    const overview = recoveryPreviewPath(plan, fit);
    expect(overview.shown).toBe(RECOVERY_PREVIEW_SEGMENT_LIMIT);
    expect(overview.sampled).toBe(true);
    expect(overview.path.match(/M/g)).toHaveLength(RECOVERY_PREVIEW_SEGMENT_LIMIT);
    expect(pickRecoveryMovement(plan, { x: 8, y: 24_987 }, 0.01, 1)).toBe(24_998);
    const detail = recoveryPreviewPath(plan, { x: 0, y: 24_986.5, width: 20, height: 1 });
    expect(detail.shown).toBe(1);
    expect(detail.sampled).toBe(false);
    expect(plan.manifest.blocks).toBe(blocks);
  });

  it('keeps the cursor anchor fixed while zooming and bounds magnification', () => {
    const fit = { x: -2, y: 3, width: 100, height: 50 };
    const anchor = { x: 0.2, y: 0.8 };
    const zoomed = zoomRecoveryPreview(fit, fit, 0.5, anchor);
    expect(zoomed.x + anchor.x * zoomed.width).toBeCloseTo(fit.x + anchor.x * fit.width);
    expect(zoomed.y + anchor.y * zoomed.height).toBeCloseTo(fit.y + anchor.y * fit.height);
    expect(zoomRecoveryPreview(fit, fit, 1e-9).width).toBe(fit.width / 1_024);
  });
});

function planFor(gcode: string): CanvasMotionPlan {
  return {
    manifest: buildMotionManifest(gcode, { machineKind: 'laser' }),
    fingerprint: fingerprintGcode(gcode),
    retentionKey: 'test-source',
    machineKind: 'laser',
    device: { ...createProject().device, origin: 'rear-left' },
    coordinateFrame: { kind: 'relative', jobOriginOffset: { x: 10, y: 20 } },
    framePerimeter: [],
    jobStart: null,
    approachFrom: null,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: 0,
  };
}
