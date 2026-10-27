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

  // Rolling audit v5 J3-P3-1 (ADR-269 Amendment 2): a level counts only the copies it adds,
  // so wrapping a drawing in blocks placed once costs the entities read and nothing more.
  it('counts each placed point once, however many blocks wrap it', () => {
    const origin = { x: 0, y: 0 };
    const line = raw('LINE', [10, '0'], [20, '0'], [11, '1'], [21, '0']);
    const blocks = new Map<string, DxfBlock>([
      ['PART', { basePoint: origin, entities: [line] }],
      [
        'SHEET',
        {
          basePoint: origin,
          entities: Array.from({ length: 10 }, () => raw('INSERT', [2, 'PART'])),
        },
      ],
      ['WRAP1', { basePoint: origin, entities: [raw('INSERT', [2, 'SHEET'])] }],
      ['WRAP2', { basePoint: origin, entities: [raw('INSERT', [2, 'WRAP1'])] }],
    ]);
    const spent = (top: RawEntity) => {
      const budget = { placed: 0, limit: 1_000 };
      const context = {
        scale: 1,
        layerColors: new Map<string, string>(),
        hiddenLayers: new Set<string>(),
        blocks,
        budget,
      };
      const { polylines } = expandEntities([top], context, null, 0);
      const points = polylines.reduce((sum, item) => sum + item.polyline.points.length, 0);
      return { points, placed: budget.placed };
    };
    // SHEET reads its 10 INSERTs and PART's line 10 times, and places 20 points.
    expect(spent(raw('INSERT', [2, 'SHEET']))).toEqual({ points: 20, placed: 20 + 20 });
    // Two wrappers read one INSERT each; their copies of those 20 points are not new.
    expect(spent(raw('INSERT', [2, 'WRAP2']))).toEqual({ points: 20, placed: 22 + 20 });
    // A 3-copy grid of SHEET reads it once and adds two more copies of its points.
    expect(spent(raw('INSERT', [2, 'SHEET'], [70, '3']))).toEqual({ points: 60, placed: 20 + 60 });
  });

  it('imports a 100,000-point drawing through four wrapper blocks, as it does flat', () => {
    for (const wrappers of [0, 4]) {
      const result = parseDxf({
        dxfText: wrappedSheetDxf(wrappers),
        id: `wrapped-${wrappers}`,
        source: 'sheet.dxf',
      });
      expect(result.kind, `${wrappers} wrappers`).toBe('ok');
      if (result.kind === 'ok') expect(result.pathCount).toBe(1_000);
    }
  });
});

/** The audit's nesting sheet: 1,000 copies of a 100-point PART in a SHEET block, placed once
 *  through `wrappers` blocks that each hold one INSERT. */
function wrappedSheetDxf(wrappers: number): string {
  const lines: string[] = ['0', 'SECTION', '2', 'BLOCKS'];
  const block = (name: string, body: readonly string[]) =>
    lines.push('0', 'BLOCK', '2', name, '10', '0', '20', '0', ...body, '0', 'ENDBLK');
  const insert = (name: string, x = 0, y = 0) => [
    '0',
    'INSERT',
    '2',
    name,
    '10',
    `${x}`,
    '20',
    `${y}`,
  ];
  const vertices = Array.from({ length: 100 }, (_, index) => [
    '10',
    `${index}`,
    '20',
    `${index % 2}`,
  ]);
  block('PART', ['0', 'LWPOLYLINE', '90', '100', '70', '0', ...vertices.flat()]);
  block(
    'SHEET',
    Array.from({ length: 1_000 }, (_, index) =>
      insert('PART', (index % 10) * 110, index * 3),
    ).flat(),
  );
  for (let level = 1; level <= wrappers; level += 1)
    block(`WRAP${level}`, insert(level === 1 ? 'SHEET' : `WRAP${level - 1}`));
  lines.push('0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
  lines.push(...insert(wrappers === 0 ? 'SHEET' : `WRAP${wrappers}`), '0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n');
}
