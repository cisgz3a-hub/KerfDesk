import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { DEFAULT_NUDGE_STEPS, type NudgeSteps } from '../state/nudge-preferences';
import { nudgeStepMm } from './nudge-step';
import { handleTransformShortcut, type TransformCtx } from './shortcuts';

function arrow(init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true, ...init });
}

function transformCtx(nudgeSteps?: NudgeSteps) {
  const nudgeSelection = vi.fn<TransformCtx['nudgeSelection']>();
  const flipSelection = vi.fn<TransformCtx['flipSelection']>();
  const ctx: TransformCtx = {
    project: createProject(),
    selectedObjectId: 'shape-1',
    selectedPathNode: null,
    applyObjectTransform: vi.fn(),
    nudgeSelection,
    nudgeSelectedPathNode: vi.fn(),
    flipSelection,
    ...(nudgeSteps === undefined ? {} : { nudgeSteps }),
  };
  return { ...ctx, nudgeSelection, flipSelection };
}

describe('arrow-key nudge distances', () => {
  it('picks 1 mm plain, 10 mm with Shift and 0.1 mm with Ctrl or Cmd', () => {
    expect(nudgeStepMm(arrow(), DEFAULT_NUDGE_STEPS)).toBe(1);
    expect(nudgeStepMm(arrow({ shiftKey: true }), DEFAULT_NUDGE_STEPS)).toBe(10);
    expect(nudgeStepMm(arrow({ ctrlKey: true }), DEFAULT_NUDGE_STEPS)).toBe(0.1);
    expect(nudgeStepMm(arrow({ metaKey: true }), DEFAULT_NUDGE_STEPS)).toBe(0.1);
  });

  it('leaves Alt (align), Ctrl+Shift and AltGr unbound', () => {
    expect(nudgeStepMm(arrow({ altKey: true }), DEFAULT_NUDGE_STEPS)).toBeNull();
    expect(nudgeStepMm(arrow({ ctrlKey: true, shiftKey: true }), DEFAULT_NUDGE_STEPS)).toBeNull();
    expect(nudgeStepMm(arrow({ ctrlKey: true, altKey: true }), DEFAULT_NUDGE_STEPS)).toBeNull();
  });

  it('moves the selection by the distances from Settings', () => {
    const ctx = transformCtx({ fineMm: 0.05, normalMm: 2, largeMm: 25 });
    for (const [init, dx] of [
      [{}, 2],
      [{ shiftKey: true }, 25],
      [{ ctrlKey: true }, 0.05],
    ] as const) {
      const event = arrow(init);
      expect(handleTransformShortcut(event, ctx)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(ctx.nudgeSelection).toHaveBeenLastCalledWith(dx, 0);
    }
  });

  it('Ctrl+Up nudges 0.1 mm up by default, and Alt+arrow is left to the align keys', () => {
    const ctx = transformCtx();
    expect(handleTransformShortcut(arrow({ key: 'ArrowUp', ctrlKey: true }), ctx)).toBe(true);
    expect(ctx.nudgeSelection).toHaveBeenCalledWith(0, -0.1);
    const alt = arrow({ altKey: true });
    expect(handleTransformShortcut(alt, ctx)).toBe(false);
    expect(alt.defaultPrevented).toBe(false);
    expect(ctx.nudgeSelection).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+H is still not a flip', () => {
    const ctx = transformCtx();
    expect(handleTransformShortcut(arrow({ key: 'h', ctrlKey: true }), ctx)).toBe(false);
    expect(ctx.flipSelection).not.toHaveBeenCalled();
  });
});
