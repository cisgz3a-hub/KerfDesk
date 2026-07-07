import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import type { DragState } from './drag-state';
import { isRightButtonDoubleClick, isStationaryRightPanClick, panOffsetForDrag } from './pan-drag';

describe('panOffsetForDrag', () => {
  it('falls back to the drag start when the canvas CSS scale is not usable', () => {
    const drag: Extract<DragState, { kind: 'pan' }> = {
      kind: 'pan',
      trigger: 'space-left-button',
      startClientX: 20,
      startClientY: 30,
      startPanX: 4,
      startPanY: -2,
    };

    expect(
      panOffsetForDrag({
        drag,
        e: { clientX: 120, clientY: 130 },
        canvas: fakePanCanvas({ width: 100, height: 100, rectWidth: 0 }),
        project: createProject(),
        viewState: { zoomFactor: 1, panX: 0, panY: 0 },
      }),
    ).toEqual({ panX: 4, panY: -2 });
  });
});

describe('isStationaryRightPanClick', () => {
  it('treats a stationary right-button pan candidate as a context click', () => {
    expect(isStationaryRightPanClick(panDrag('right-button'), { clientX: 104, clientY: 100 })).toBe(
      true,
    );
  });

  it('keeps right-button drags as panning after the movement threshold', () => {
    expect(isStationaryRightPanClick(panDrag('right-button'), { clientX: 105, clientY: 100 })).toBe(
      false,
    );
  });

  it('never opens the context bar for middle-button or Space panning', () => {
    expect(
      isStationaryRightPanClick(panDrag('middle-button'), { clientX: 100, clientY: 100 }),
    ).toBe(false);
    expect(
      isStationaryRightPanClick(panDrag('space-left-button'), { clientX: 100, clientY: 100 }),
    ).toBe(false);
  });
});

describe('isRightButtonDoubleClick', () => {
  it('recognizes the second click of a right-button double-click', () => {
    expect(isRightButtonDoubleClick({ button: 2, detail: 2 })).toBe(true);
  });

  it('ignores single right-clicks and non-right double-clicks', () => {
    expect(isRightButtonDoubleClick({ button: 2, detail: 1 })).toBe(false);
    expect(isRightButtonDoubleClick({ button: 0, detail: 2 })).toBe(false);
  });
});

function fakePanCanvas(args: {
  readonly width: number;
  readonly height: number;
  readonly rectWidth: number;
}): HTMLCanvasElement {
  return {
    width: args.width,
    height: args.height,
    getBoundingClientRect: () =>
      ({
        left: 0,
        top: 0,
        width: args.rectWidth,
        height: args.height,
      }) as DOMRect,
  } as HTMLCanvasElement;
}

function panDrag(
  trigger: 'middle-button' | 'right-button' | 'space-left-button',
): Extract<DragState, { kind: 'pan' }> {
  return {
    kind: 'pan',
    trigger,
    startClientX: 100,
    startClientY: 100,
    startPanX: 0,
    startPanY: 0,
  };
}
