// Default CNC tool library stable-ID + shape invariants (D-S04-004). The ids
// are referenced by .lf2 files, the default toolId, and other tests, so this
// pins their integrity: unique ids, positive finite diameters, finite tip
// angles where the kind requires them, and a resolvable default toolId.

import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, DEFAULT_CNC_TOOLS } from './machine';

// v-bit and engraving tools cut a cone; their included angle is load-
// bearing (v-carve depth uses tan(θ/2)), so it must be present and finite.
const ANGLE_REQUIRED_KINDS = new Set(['v-bit', 'engraving']);

describe('DEFAULT_CNC_TOOLS', () => {
  it('has unique tool ids', () => {
    const ids = DEFAULT_CNC_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a finite positive diameter for every tool', () => {
    for (const tool of DEFAULT_CNC_TOOLS) {
      expect(Number.isFinite(tool.diameterMm)).toBe(true);
      expect(tool.diameterMm).toBeGreaterThan(0);
    }
  });

  it('has a finite included angle for every angle-driven tool kind', () => {
    for (const tool of DEFAULT_CNC_TOOLS) {
      if (ANGLE_REQUIRED_KINDS.has(tool.kind)) {
        expect(tool.tipAngleDeg).toBeDefined();
        expect(Number.isFinite(tool.tipAngleDeg)).toBe(true);
        expect(tool.tipAngleDeg ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("resolves the config's default toolId to a real tool", () => {
    const found = DEFAULT_CNC_TOOLS.some((tool) => tool.id === DEFAULT_CNC_MACHINE_CONFIG.toolId);
    expect(found).toBe(true);
  });

  it('includes both common hobby-router 90-degree V-bit sizes', () => {
    expect(DEFAULT_CNC_TOOLS).toContainEqual({
      id: 'vb-90-6350-hobby',
      name: '90° V-bit — 6.35 mm (1/4") cut, 3.175 mm (1/8") shank',
      kind: 'v-bit',
      diameterMm: 6.35,
      tipAngleDeg: 90,
      family: 'v-groove',
      shankDiameterMm: 3.175,
      catalogId: 'v90-hobby-0125',
    });
    expect(DEFAULT_CNC_TOOLS).toContainEqual({
      id: 'vb-90-12700-hobby',
      name: '90° V-bit — 12.7 mm (1/2") cut, 6.35 mm (1/4") shank',
      kind: 'v-bit',
      diameterMm: 12.7,
      tipAngleDeg: 90,
      family: 'v-groove',
      shankDiameterMm: 6.35,
      catalogId: 'v90-hobby-025',
    });
  });
});
