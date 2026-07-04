import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { drawScene } from './draw-scene';

const gcodeMocks = vi.hoisted(() => ({
  prepareOutput: vi.fn(),
}));

vi.mock('../../io/gcode', () => gcodeMocks);

beforeEach(() => {
  gcodeMocks.prepareOutput.mockReset();
});

describe('drawScene preview preparation boundary', () => {
  it('does not build a preview toolpath from inside the draw path', () => {
    drawScene(noOpContext(), 800, 600, createProject(), {
      selectedId: null,
      preview: true,
    });

    expect(gcodeMocks.prepareOutput).not.toHaveBeenCalled();
  });
});

function noOpContext(): CanvasRenderingContext2D {
  return new Proxy(
    {},
    {
      get() {
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
}
