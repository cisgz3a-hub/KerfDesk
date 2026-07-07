import { describe, expect, it } from 'vitest';
import type { BoxSpec } from './box-spec';
import { generateBox } from './generate-box';
import { framePoint, partFrame } from './assembled-layout';

const SPEC: BoxSpec = {
  widthMm: 80,
  depthMm: 50,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'slide-lid',
  clearanceMm: 0.2,
  relief: { kind: 'none' },
  partSpacingMm: 8,
  dividersXCount: 1,
};

describe('assembled-layout', () => {
  const result = generateBox(SPEC);
  if (result.kind !== 'generated') throw new Error(result.kind);
  const byName = new Map(result.panels.map((panel) => [panel.name, panel]));

  it('gives every generated part a frame', () => {
    for (const panel of result.panels) {
      expect(partFrame(panel, SPEC), panel.name).not.toBeNull();
    }
  });

  it('places the walls on their slabs (drawing convention)', () => {
    const back = byName.get('Back');
    const frame = back === undefined ? null : partFrame(back, SPEC);
    expect(frame?.originMm).toEqual({ x: 0, y: 53, z: 0 });
    expect(frame?.normalDir).toEqual({ x: 0, y: 1, z: 0 });
    // Local (u, v) = (x, z): a point maps straight onto the slab.
    if (frame === null || frame === undefined) return;
    expect(framePoint(frame, 10, 5, 3)).toEqual({ x: 10, y: 56, z: 5 });
  });

  it('puts the slide lid in the channel band', () => {
    const lid = byName.get('Lid');
    const frame = lid === undefined ? null : partFrame(lid, SPEC);
    // Outer height 39: channel band [33, 36].
    expect(frame?.originMm.z).toBe(33);
    expect(frame?.normalDir).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('stands dividers on the bottom face at their slab', () => {
    const divider = byName.get('Divider X1');
    const frame = divider === undefined ? null : partFrame(divider, SPEC);
    expect(frame?.originMm.z).toBe(3);
    expect(frame?.normalDir).toEqual({ x: 1, y: 0, z: 0 });
    // X-dividers span depth: local u maps to +y.
    expect(frame?.uDir).toEqual({ x: 0, y: 1, z: 0 });
  });
});
