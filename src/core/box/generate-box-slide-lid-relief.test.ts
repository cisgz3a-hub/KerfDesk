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

describe('generateBox slide-lid relief', () => {
  it('does not carve seat relief into the decorative thumb notch', () => {
    const relieved = generateBox(SPEC);
    const plain = generateBox({ ...SPEC, relief: { kind: 'none' } });

    expect(localOutline(relieved, 'lid')).toEqual(localOutline(plain, 'lid'));
    expect(localOutline(relieved, 'bottom')).not.toEqual(localOutline(plain, 'bottom'));
  });
});

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
