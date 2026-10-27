import { describe, expect, it } from 'vitest';
import { DXF_EXPANSION_REFUSAL, nestedGridsPastBudgetDxf } from '../../__fixtures__/nested-minsert';
import { expandEntities, type DxfBlock, type RawEntity } from './dxf-expand';
import {
  createDxfExpansionBudget,
  DXF_BLOCK_EXPANSION_LIMITS,
  DxfExpansionRefusal,
  spendDxfExpansion,
} from './dxf-expansion-budget';
import { parseDxf } from './parse-dxf';

function raw(type: string, ...pairs: ReadonlyArray<readonly [number, string]>): RawEntity {
  return { type, tags: pairs.map(([code, value]) => ({ code, value })), vertexRuns: [] };
}

describe('DXF block expansion budget', () => {
  it('lets any file place the floor, and more for a larger file', () => {
    expect(createDxfExpansionBudget(300).limit).toBe(DXF_BLOCK_EXPANSION_LIMITS.floor);
    expect(createDxfExpansionBudget(3_000_000).limit).toBe(3_000_000);
    const budget = createDxfExpansionBudget(300);
    expect(() => spendDxfExpansion(budget, DXF_BLOCK_EXPANSION_LIMITS.floor)).not.toThrow();
    expect(() => spendDxfExpansion(budget, 1)).toThrow(DXF_EXPANSION_REFUSAL);
  });

  it('refuses a drawing whose nested grids place more than the budget', () => {
    const dxfText = nestedGridsPastBudgetDxf();
    expect(dxfText.length).toBeLessThan(1_000);
    const result = parseDxf({ dxfText, id: 'grid', source: 'grid.dxf' });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.reason).toMatch(DXF_EXPANSION_REFUSAL);
  });

  it('counts the entities of placed blocks that draw nothing', () => {
    // EMPTY holds only text; FAN places EMPTY ten times. Each FAN placement reads
    // twenty entities and draws nothing.
    const blocks = new Map<string, DxfBlock>([
      ['EMPTY', { basePoint: { x: 0, y: 0 }, entities: [raw('TEXT', [1, 'x'])] }],
      [
        'FAN',
        {
          basePoint: { x: 0, y: 0 },
          entities: Array.from({ length: 10 }, () => raw('INSERT', [2, 'EMPTY'])),
        },
      ],
    ]);
    const context = {
      scale: 1,
      layerColors: new Map<string, string>(),
      hiddenLayers: new Set<string>(),
      blocks,
      budget: { placed: 0, limit: 50 },
    };
    const fan = raw('INSERT', [2, 'FAN']);
    expect(expandEntities([fan, fan], context, null, 0).polylines).toEqual([]);
    expect(context.budget.placed).toBe(40);
    expect(() => expandEntities([fan], context, null, 0)).toThrow(DxfExpansionRefusal);
  });
});
