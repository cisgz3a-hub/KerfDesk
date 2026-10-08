import type { ProductionNestDefinition, ProductionNestingInput } from './production-nest';

export function productionFixture(): ProductionNestingInput {
  const part = {
    id: 'panel',
    name: 'Panel',
    objectIds: ['source'],
    quantity: 6,
    materialKey: 'Birch ply',
    thicknessMm: 6,
    rotationAngles: [0] as const,
    grain: 'none' as const,
  };
  const stock = {
    id: 'one',
    name: 'First stock',
    stockId: 'board-one',
    kind: 'sheet' as const,
    materialKey: 'Birch ply',
    thicknessMm: 6,
    widthMm: 46,
    heightMm: 26,
    grain: 'none' as const,
  };
  const definition: ProductionNestDefinition = {
    id: 'run',
    name: 'Panel run',
    parts: [part],
    sheets: [
      stock,
      { ...stock, id: 'two', name: 'Remnant', kind: 'remnant', stockId: 'offcut-two' },
    ],
    padding: 2,
    goal: 'compact',
    method: 'fast',
    optimise: false,
  };
  return {
    definition,
    geometry: [
      {
        partId: 'panel',
        item: { id: 'panel', width: 20, height: 10, canRotate: false },
        vectorLengthMm: 60,
      },
    ],
  };
}
