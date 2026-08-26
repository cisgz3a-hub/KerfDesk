import { describe, expect, it } from 'vitest';
import type { Toolpath } from '../../core/job';
import {
  displayPolylinePointIndices,
  displayStepIndices,
  previewDisplayDecimation,
} from './preview-display-decimation';

describe('preview display decimation', () => {
  it('keeps a long cut connected through its first and final points', () => {
    expect([...displayPolylinePointIndices(8, 3)]).toEqual([0, 3, 6, 7]);
  });

  it('keeps final route step while reporting exact source and drawn counts', () => {
    const steps: Toolpath['steps'] = Array.from({ length: 8 }, (_, index) => ({
      kind: 'travel' as const,
      from: { x: index, y: 0 },
      to: { x: index + 1, y: 0 },
      length: 1,
    }));
    const toolpath: Toolpath = { steps, totalLength: 8 };

    expect([...displayStepIndices(steps.length, 3)]).toEqual([0, 3, 6, 7]);
    expect(previewDisplayDecimation(toolpath, 3)).toEqual({
      threshold: 3,
      sourceSteps: 8,
      drawnSteps: 4,
      sourceSegments: 8,
      drawnSegments: 4,
    });
  });

  it('reports long-polyline segment reduction even when no route step is omitted', () => {
    const toolpath: Toolpath = {
      steps: [
        {
          kind: 'cut',
          color: '#000000',
          length: 7,
          polyline: Array.from({ length: 8 }, (_, x) => ({ x, y: x % 2 })),
        },
      ],
      totalLength: 7,
    };

    expect(previewDisplayDecimation(toolpath, 3)).toEqual({
      threshold: 3,
      sourceSteps: 1,
      drawnSteps: 1,
      sourceSegments: 7,
      drawnSegments: 3,
    });
  });
});
