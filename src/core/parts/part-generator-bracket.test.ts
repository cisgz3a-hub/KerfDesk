import { describe, expect, it } from 'vitest';
import { defaultPartGenerator, type BracketGenerator } from './part-generator';
import { materializePartGenerator } from './materialize-part-generator';
import { regeneratePartGenerator } from './regenerate-part-generator';
import { generatedPart, requirePart } from './part-generator.test-fixture';

const bracket = defaultPartGenerator('bracket') as BracketGenerator;

describe('bracket hole offsets use the actual hole edge clearance', () => {
  it.each([34, 35, 37])(
    'materializes holes %s mm from the leg ends while both holes stay inside',
    (holeOffsetMm) => {
      const built = requirePart(materializePartGenerator({ ...bracket, holeOffsetMm }));
      const horizontal = built.paths[1]?.curves?.[0];
      const vertical = built.paths[2]?.curves?.[0];
      expect(horizontal?.start).toEqual({ x: 60 - holeOffsetMm + 2, y: 6 });
      expect(vertical?.start).toEqual({ x: 8, y: 40 - holeOffsetMm });
      expect(built.source.pathKeys).toEqual(['boundary', 'mount-horizontal', 'mount-vertical']);
    },
  );

  it('regenerates valid inset holes without changing operation ownership or source geometry', () => {
    const original = generatedPart(bracket);
    const next = requirePart(regeneratePartGenerator(original, { ...bracket, holeOffsetMm: 37 }));
    expect(next.paths[1]?.curves?.[0]?.start).toEqual({ x: 25, y: 6 });
    expect(next.paths[2]?.curves?.[0]?.start).toEqual({ x: 8, y: 3 });
    expect(next.paths.map((path) => path.operationIds)).toEqual(
      original.paths.map((path) => path.operationIds),
    );
    expect(original.partGenerator.definition).toBeDefined();
    expect((original.partGenerator.definition as BracketGenerator).holeOffsetMm).toBe(8);
  });

  it('rejects tangency at either end, holes wider than a leg and actual inter-hole collisions', () => {
    for (const definition of [
      { ...bracket, holeOffsetMm: 2 },
      { ...bracket, holeOffsetMm: 38 },
      { ...bracket, holeDiameterMm: 12 },
      { ...bracket, widthMm: 20, heightMm: 20, holeOffsetMm: 14 },
    ])
      expect(materializePartGenerator(definition).kind).toBe('invalid');
  });
});
