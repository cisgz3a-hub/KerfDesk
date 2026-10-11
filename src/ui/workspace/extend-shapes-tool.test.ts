import type { MouseEvent as ReactMouseEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { extendStatusMessage } from './extend-shapes-tool';
import { computeView } from './view-transform';
import { runClickTool } from './workspace-click-tools';

afterEach(() => vi.restoreAllMocks());

describe('Extend pointer routing', () => {
  it.each([0.5, 1, 4])('uses an eight pixel endpoint radius at zoom %s', (zoomFactor) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 810,
      bottom: 620,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    });
    const project = createProject();
    const viewState = { zoomFactor, panX: 0, panY: 0 };
    const view = computeView(
      800,
      600,
      project.device.bedWidth,
      project.device.bedHeight,
      viewState,
    );
    const extend = vi.spyOn(useStore.getState(), 'extendShapeAt').mockReturnValue(true);
    const e = {
      clientX: 10 + view.offsetX + 10 * view.scale,
      clientY: 20 + view.offsetY + 15 * view.scale,
    } as ReactMouseEvent<HTMLCanvasElement>;
    expect(
      runClickTool({ e, canvas, project, viewState, toolMode: { kind: 'extend-shapes' } }),
    ).toBe(true);
    expect(extend).toHaveBeenCalledOnce();
    expect(extend.mock.calls[0]?.[0].x).toBeCloseTo(10, 8);
    expect(extend.mock.calls[0]?.[0].y).toBeCloseTo(15, 8);
    expect(extend.mock.calls[0]?.[1]).toBeCloseTo(8 / view.scale, 8);
  });

  it('explains an unusable tangent and the no-boundary outcome', () => {
    expect(extendStatusMessage('curved-end')).toContain('no usable tangent');
    expect(extendStatusMessage('no-boundary')).toContain('stays unchanged');
  });
});
