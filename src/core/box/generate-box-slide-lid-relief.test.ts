import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import type { BoxSpec } from './box-spec';
import { generateBox, type BoxPanel, type GenerateBoxResult } from './generate-box';

const SPEC: BoxSpec = {
  widthMm: 60,
  depthMm: 40,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'slide-lid',
  clearanceMm: 0.2,
  relief: { kind: 'corner-overcut', toolDiameterMm: 1 },
  partSpacingMm: 8,
};

// Inner 60 × 40 at T = 3: the lid's shoulders sit at y = 40 and its tongue
// runs on to y = 43; the thumb notch (radius 8) stays below y = 8.
const NOTCH_REGION_MAX_Y = 10;
const SHOULDER_Y = 40;

describe('generateBox slide-lid relief', () => {
  it('does not carve seat relief into the decorative thumb notch', () => {
    const relieved = localOutline(generateBox(SPEC), 'lid');
    const plain = localOutline(generateBox({ ...SPEC, relief: { kind: 'none' } }), 'lid');

    expect(notchPoints(relieved)).toEqual(notchPoints(plain));
    expect(notchPoints(plain).length).toBeGreaterThan(10);
  });

  it('relieves the tongue shoulders so the lid seats on the channel posts (ADR-116 Amd 1)', () => {
    const relieved = localOutline(generateBox(SPEC), 'lid');
    const plain = localOutline(generateBox({ ...SPEC, relief: { kind: 'none' } }), 'lid');
    const nearShoulder = (points: ReadonlyArray<Vec2>): number =>
      points.filter((point) => Math.abs(point.y - SHOULDER_Y) < 1.5).length;

    expect(nearShoulder(relieved)).toBeGreaterThan(nearShoulder(plain));
    // Each reflex shoulder corner gets a dogbone that dips past the shoulder
    // line into the lid body.
    const dogboneDepth = Math.min(
      ...relieved.filter((p) => p.y < SHOULDER_Y && p.y > 30).map((p) => p.y),
    );
    expect(dogboneDepth).toBeLessThan(SHOULDER_Y - 0.05);
  });

  it('still relieves the walls', () => {
    expect(localOutline(generateBox(SPEC), 'bottom')).not.toEqual(
      localOutline(generateBox({ ...SPEC, relief: { kind: 'none' } }), 'bottom'),
    );
  });
});

// The distinct vertices in the notch region (rings may repeat their seam
// vertex depending on which clipper pass produced them).
function notchPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<string> {
  const keys = points
    .filter((point) => point.y < NOTCH_REGION_MAX_Y)
    .map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`);
  return [...new Set(keys)].sort();
}

function localOutline(result: GenerateBoxResult, panelId: BoxPanel['panel']): ReadonlyArray<Vec2> {
  expect(result.kind).toBe('generated');
  if (result.kind !== 'generated') return [];
  const panel = result.panels.find((candidate) => candidate.panel === panelId);
  expect(panel).toBeDefined();
  if (panel === undefined) return [];
  return panel.outline.points.map((point) => ({
    x: point.x - panel.offsetMm.x,
    y: point.y - panel.offsetMm.y,
  }));
}
