import { describe, expect, it } from 'vitest';
import { parsePartGeneratorSource } from '../../io/project/project-part-generator-validator';
import {
  defaultPartGenerator,
  type HoleGridGenerator,
  type PartGeneratorDefinition,
} from './part-generator';
import { materializePartGenerator } from './materialize-part-generator';
import { regeneratePartGenerator } from './regenerate-part-generator';
import { generatedPart, requirePart } from './part-generator.test-fixture';

function grid(overrides: Partial<HoleGridGenerator>): HoleGridGenerator {
  return { ...(defaultPartGenerator('hole-grid') as HoleGridGenerator), ...overrides };
}

describe('centred single-row and single-column part grids', () => {
  it.each([
    { widthMm: 8, heightMm: 8, rows: 1, columns: 1, edgeOffsetMm: 8 },
    { widthMm: 6, heightMm: 40, rows: 2, columns: 1, edgeOffsetMm: 8 },
    { widthMm: 40, heightMm: 6, rows: 1, columns: 2, edgeOffsetMm: 8 },
    { widthMm: 8, heightMm: 8, rows: 1, columns: 1, edgeOffsetMm: 1 },
  ])(
    'uses the centre for singleton axes without applying their unused offset: %j',
    (dimensions) => {
      const definition = grid(dimensions);
      const built = requirePart(materializePartGenerator(definition));
      const holes = built.paths.slice(1);
      expect(holes).toHaveLength(dimensions.rows * dimensions.columns);
      expect(parsePartGeneratorSource(JSON.parse(JSON.stringify(built.source)))).toEqual({
        kind: 'ok',
        value: built.source,
      });
      for (const path of holes) {
        const curve = path.curves?.[0];
        if (curve === undefined) throw new Error('Missing hole geometry');
        if (dimensions.columns === 1) expect(curve.start.x - 2).toBe(dimensions.widthMm / 2);
        if (dimensions.rows === 1) expect(curve.start.y).toBe(dimensions.heightMm / 2);
      }
    },
  );

  it('resizes a one-column part to its actual hole clearance and keeps machining identity', () => {
    const original = generatedPart(grid({ rows: 2, columns: 1 }));
    const next = requirePart(
      regeneratePartGenerator(original, { ...original.partGenerator.definition, widthMm: 6 }),
    );
    expect(next.bounds.maxX).toBe(6);
    expect(next.partGenerator.pathKeys).toEqual(original.partGenerator.pathKeys);
    expect(next.paths.map((path) => path.operationIds)).toEqual(
      original.paths.map((path) => path.operationIds),
    );
    expect(original.bounds.maxX).toBe(60);
  });

  it('permits a centred fixture grid while enforcing its independent mounting holes', () => {
    const definition = {
      ...defaultPartGenerator('fixture'),
      widthMm: 20,
      heightMm: 20,
      rows: 1,
      columns: 1,
      edgeOffsetMm: 20,
      mountOffsetMm: 3,
      mountDiameterMm: 1,
    } as PartGeneratorDefinition;
    const geometry = requirePart(materializePartGenerator(definition));
    expect(geometry.paths).toHaveLength(6);
    expect(geometry.paths[5]?.curves?.[0]?.start).toEqual({ x: 12, y: 10 });
    expect(materializePartGenerator({ ...definition, widthMm: 6 }).kind).toBe('invalid');
  });

  it('still rejects holes touching the boundary or using an active offset without clearance', () => {
    for (const dimensions of [
      { widthMm: 4, heightMm: 8, rows: 1, columns: 1, edgeOffsetMm: 8 },
      { widthMm: 6, heightMm: 40, rows: 2, columns: 1, edgeOffsetMm: 1 },
      { widthMm: 40, heightMm: 6, rows: 1, columns: 2, edgeOffsetMm: 1 },
    ])
      expect(materializePartGenerator(grid(dimensions)).kind).toBe('invalid');
  });
});
