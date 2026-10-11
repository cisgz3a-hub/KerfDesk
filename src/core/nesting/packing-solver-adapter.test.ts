import { describe, expect, it } from 'vitest';
import {
  advancedNestImproves,
  prepareAdvancedNest,
  readAdvancedNest,
} from './packing-solver-adapter';
import { productionFixture } from './production-nest.test-fixture';
import { planProductionNest } from './production-nest-plan';
import type { ProductionNestingInput } from './production-nest';

function fixture(quantity = 1): ProductionNestingInput {
  const input = productionFixture();
  return {
    ...input,
    definition: {
      ...input.definition,
      method: 'outline',
      parts: input.definition.parts.map((p) => ({
        ...p,
        quantity,
        rotationAngles: [0, 90, 180, 270],
      })),
    },
  };
}
const item = (x = 1, y = 1, angle = 0) => ({ id: 0, x, y, angle, mirror: false });
const certificate = (items: unknown[], id = 0, copies = 1) =>
  JSON.stringify({ bins: [{ id, copies, items }] });

describe('advanced nesting boundary', () => {
  it('exports declared spacing, stock copies and discrete rotations without mirroring', () => {
    const request = prepareAdvancedNest(fixture(3));
    expect(request.kind).toBe('ready');
    if (request.kind !== 'ready') return;
    const data = JSON.parse(request.instance);
    expect(data.parameters.item_item_minimum_spacing).toBe(2);
    expect(
      data.bin_types.map((b: { copies: number; item_bin_minimum_spacing: number }) => [
        b.copies,
        b.item_bin_minimum_spacing,
      ]),
    ).toEqual([
      [1, 1],
      [1, 1],
    ]);
    expect(data.item_types[0].copies).toBe(3);
    expect(data.item_types[0].allowed_rotations).toEqual(
      [0, 90, 180, 270].map((angle) => ({ start: angle, end: angle, mirror: false })),
    );
  });
  it('preserves holes and disconnected components in one rigid part', () => {
    const input = fixture();
    const rectangle = (x: number, y: number, w: number, h: number) => [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
    const outline = [
      rectangle(0, 0, 20, 10),
      rectangle(2, 2, 4, 4).reverse(),
      rectangle(25, 0, 5, 5),
    ];
    const request = prepareAdvancedNest({
      ...input,
      geometry: [
        { ...input.geometry[0]!, item: { ...input.geometry[0]!.item, width: 30, outline } },
      ],
    });
    expect(request.kind).toBe('ready');
    if (request.kind !== 'ready') return;
    const shapes = JSON.parse(request.instance).item_types[0].shapes;
    expect(shapes).toHaveLength(2);
    expect(shapes.flatMap((s: { holes: unknown[] }) => s.holes)).toHaveLength(1);
  });
  it('translates the solver origin convention and recomputes all quantities', () => {
    const input = fixture();
    const result = readAdvancedNest(input, certificate([item(11, 1, 90)]));
    expect(result?.produced).toBe(1);
    expect(result?.requested).toBe(1);
    expect(result?.sheets[0]?.placements[0]).toEqual({
      id: 'panel:1',
      partId: 'panel',
      copyIndex: 0,
      x: 1,
      y: 1,
      rotationDeg: 90,
      rotated90: true,
    });
  });
  it.each([
    ['overlap', [item(), item(10, 1)], 0, 1],
    ['short spacing', [item(), item(22.999, 1)], 0, 1],
    ['outside', [item(-1, 1)], 0, 1],
    ['mirrored', [{ ...item(), mirror: true }], 0, 1],
    ['unknown part', [{ ...item(), id: 8 }], 0, 1],
    ['unknown stock', [item()], 8, 1],
    ['extra stock copies', [item()], 0, 2],
    ['non-finite coordinate', [{ ...item(), x: Number.POSITIVE_INFINITY }], 0, 1],
  ])('rejects %s independently of solver totals', (_name, items, id, copies) => {
    expect(
      readAdvancedNest(fixture(2), certificate(items as unknown[], id as number, copies as number)),
    ).toBeNull();
  });
  it('rejects forbidden grain rotations, excess copies, duplicate sheets and malformed certificates', () => {
    const input = fixture();
    const limited = {
      ...input,
      definition: {
        ...input.definition,
        parts: input.definition.parts.map((p) => ({ ...p, rotationAngles: [0] as const })),
      },
    };
    expect(readAdvancedNest(limited, certificate([item(11, 1, 90)]))).toBeNull();
    expect(readAdvancedNest(input, certificate([item(), item(23, 1)]))).toBeNull();
    expect(
      readAdvancedNest(
        input,
        JSON.stringify({
          bins: [
            { id: 0, copies: 1, items: [item()] },
            { id: 0, copies: 1, items: [item()] },
          ],
        }),
      ),
    ).toBeNull();
    expect(readAdvancedNest(input, 'not json')).toBeNull();
  });
  it('retains the standard draft for unsupported declarations and larger work budgets', () => {
    const input = fixture();
    expect(
      prepareAdvancedNest({ ...input, definition: { ...input.definition, goal: 'grid' } }).kind,
    ).toBe('unavailable');
    expect(
      prepareAdvancedNest({
        ...input,
        definition: {
          ...input.definition,
          sheets: input.definition.sheets.map((s, i) => ({ ...s, grain: i === 0 ? 'x' : 'y' })),
        },
      }).kind,
    ).toBe('unavailable');
    expect(prepareAdvancedNest(fixture(501)).kind).toBe('unavailable');
  });
  it('does not replace a complete draft with an empty or less complete timeout result', () => {
    const input = fixture();
    const baseline = planProductionNest(input);
    const empty = readAdvancedNest(input, JSON.stringify({ bins: [] }));
    expect(empty?.produced).toBe(0);
    expect(advancedNestImproves(empty!, baseline)).toBe(false);
  });
});
