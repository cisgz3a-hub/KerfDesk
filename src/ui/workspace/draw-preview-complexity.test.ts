import { describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type TracedImage,
} from '../../core/scene';
import { buildPreviewToolpath } from './draw-preview';

const gcodeMocks = vi.hoisted(() => ({
  prepareOutput: vi.fn(() => {
    throw new Error('prepareOutput should not run for a preview-skipped huge trace');
  }),
}));

vi.mock('../../io/gcode', () => gcodeMocks);

function hugeTraceProject() {
  const points = Array.from({ length: 10_002 }, (_, x) => ({ x, y: 0 }));
  const trace: TracedImage = {
    kind: 'traced-image',
    id: 'trace-1',
    source: 'trace.png',
    traceMode: 'centerline',
    bounds: { minX: 0, minY: 0, maxX: 10_001, maxY: 0 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [{ closed: false, points }] }],
  };
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [trace],
    },
  };
}

describe('buildPreviewToolpath complexity guard', () => {
  it('skips huge traces before full output preparation', () => {
    const toolpath = buildPreviewToolpath(hugeTraceProject());

    expect(gcodeMocks.prepareOutput).not.toHaveBeenCalled();
    expect(toolpath.totalLength).toBe(0);
  });
});
