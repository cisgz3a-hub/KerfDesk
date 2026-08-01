import { describe, expect, it } from 'vitest';
import type { CncTool } from '../../core/scene';
import { cncToolFamilyLabel, groupCncTools } from './CncToolOptions';

const TOOLS: ReadonlyArray<CncTool> = [
  { id: 'v', name: 'V', kind: 'v-bit', diameterMm: 6, family: 'v-groove' },
  { id: 'u', name: 'Up', kind: 'end-mill', diameterMm: 3, family: 'upcut' },
  { id: 'b', name: 'Ball', kind: 'ball-nose', diameterMm: 3 },
  { id: 's', name: 'Square', kind: 'end-mill', diameterMm: 3 },
  { id: 'x', name: 'Odd', kind: 'end-mill', diameterMm: 2, family: 'shop-special' },
];

describe('CncToolOptions grouping', () => {
  it('uses stable family order while preserving tool order inside a family', () => {
    const groups = groupCncTools(TOOLS);
    expect(groups.map((group) => group.key)).toEqual([
      'straight',
      'upcut',
      'ball-nose',
      'v-groove',
      'shop-special',
    ]);
    expect(groups.find((group) => group.key === 'upcut')?.tools).toEqual([TOOLS[1]]);
  });

  it('falls back from legacy kind and labels unknown custom families honestly', () => {
    expect(cncToolFamilyLabel(TOOLS[2] as CncTool)).toBe('Ball-nose end mills');
    expect(
      cncToolFamilyLabel({
        id: 'mortise-envelope',
        name: 'Operator-matched mortise envelope',
        kind: 'end-mill',
        diameterMm: 6.35,
        family: 'mortise',
      }),
    ).toBe('Mortise-bit envelopes');
    expect(cncToolFamilyLabel(TOOLS[4] as CncTool)).toBe('Custom / other (shop-special)');
    expect(
      cncToolFamilyLabel({
        id: 'prototype-key',
        name: 'Prototype key',
        kind: 'end-mill',
        diameterMm: 2,
        family: 'constructor',
      }),
    ).toBe('Custom / other (constructor)');
  });
});
