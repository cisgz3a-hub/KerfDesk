import { describe, expect, it } from 'vitest';
import { studioToolSpec } from './use-inspector-stage';
import type { ProgramTool } from './tool-sections';

const tool = (geometry: ProgramTool['geometry']): ProgramTool => ({
  label: 'Bit',
  geometry,
  toolId: 'bit',
  moveCount: 1,
});

describe('studioToolSpec', () => {
  it('draws a laser head for a laser program whatever it says about bits', () => {
    expect(studioToolSpec(null, 'laser')).toEqual({ kind: 'laser' });
  });

  it('draws the bit a program states, tip at height zero', () => {
    const spec = studioToolSpec(tool({ kind: 'ball-nose', diameterMm: 6 }), undefined);
    if (spec.kind !== 'bit') throw new Error('expected a bit');
    expect(spec.profile[0]).toEqual({ radiusMm: 0, heightMm: 0 });
    expect(Math.max(...spec.profile.map((point) => point.radiusMm))).toBeCloseTo(3, 6);
  });

  it('keeps the plain marker rather than guess an unstated or incomplete bit', () => {
    expect(studioToolSpec(null, 'cnc')).toEqual({ kind: 'none' });
    expect(studioToolSpec(tool(null), 'cnc')).toEqual({ kind: 'none' });
    // A V-bit without its angle has no truthful cone to draw.
    expect(studioToolSpec(tool({ kind: 'v-bit', diameterMm: 12 }), 'cnc')).toEqual({
      kind: 'none',
    });
  });
});
