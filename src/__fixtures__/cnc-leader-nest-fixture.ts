import type { Project } from '../core/scene';
import type { ProductionNestDefinition } from '../core/nesting/production-nest';
import {
  benchmarkProject,
  benchmarkLayer,
  benchmarkRectangle,
  benchmarkVector,
} from './cnc-leader-fixtures';
export function leaderNestBenchmark(): {
  readonly project: Project;
  readonly definition: ProductionNestDefinition;
} {
  const base = benchmarkProject(),
    source = benchmarkVector(
      'panel',
      [benchmarkRectangle(0, 0, 20, 10), benchmarkRectangle(3, 3, 2, 2)],
      ['profile'],
    );
  const part = {
    id: 'panel',
    name: 'Grained panel',
    objectIds: [source.id],
    quantity: 12,
    materialKey: 'Birch ply',
    thicknessMm: 6,
    rotationAngles: [0, 90, 180, 270] as const,
    grain: 'x' as const,
  };
  const sheet = {
    id: 'one',
    name: 'Sheet',
    stockId: 'board',
    kind: 'sheet' as const,
    materialKey: 'Birch ply',
    thicknessMm: 6,
    widthMm: 68,
    heightMm: 42,
    grain: 'x' as const,
  };
  return {
    project: {
      ...base,
      scene: {
        layers: [
          benchmarkLayer('profile', {
            cutType: 'profile-on-path',
            toolId: 'end2',
            depthMm: 1,
            depthPerPassMm: 1,
          }),
        ],
        objects: [source],
      },
    },
    definition: {
      id: 'twelve',
      name: 'Twelve grained panels',
      parts: [part],
      sheets: [
        sheet,
        {
          ...sheet,
          id: 'two',
          name: 'Remnant',
          stockId: 'offcut',
          kind: 'remnant',
          widthMm: 72,
          heightMm: 48,
        },
      ],
      padding: 2,
      goal: 'compact',
      method: 'outline',
      optimise: false,
    },
  };
}
export const INTERRUPTED_ACCOUNTABILITY_PROGRAM =
  [
    'G21',
    'G90',
    'G54',
    'G94',
    'G0 Z5',
    'M3 S12000',
    'G0 X10 Y10',
    'G1 Z-1 F100',
    'G1 X20 Y10 F600',
    'G2 X25 Y15 I1 J0',
    'G81 X30 Y20 Z-2 R1 F100',
    'G80',
    'G1 X35 Y25',
    'M0',
    'G0 Z5',
    'M5',
  ].join('\n') + '\n';
