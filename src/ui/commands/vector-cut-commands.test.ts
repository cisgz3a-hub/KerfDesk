import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { buildAppCommands, commandById, runCommand } from './command-registry';
import { baseCtx } from './command-registry-test-helpers';
import { vectorCutCommandContext } from './vector-cut-command-context';

afterEach(() => {
  useUiStore.getState().resetToolMode();
});

describe('Trim Shapes and Cut Shapes commands', () => {
  it('offers Cut Shapes once something is selected', () => {
    const cutShapes = vi.fn();
    const idle = commandById(buildAppCommands(baseCtx({ cutShapes })), 'tools.cut-shapes');
    expect(idle).toMatchObject({ enabled: false, label: 'Cut Shapes' });
    expect(idle.title).toContain('Select the shapes to cut');
    expect(runCommand(idle)).toBe(false);

    const ready = commandById(
      buildAppCommands(baseCtx({ hasSelection: true, cutShapes })),
      'tools.cut-shapes',
    );
    expect(runCommand(ready)).toBe(true);
    expect(cutShapes).toHaveBeenCalledTimes(1);
  });

  it('checks Trim Shapes while the tool is on', () => {
    const off = commandById(buildAppCommands(baseCtx()), 'tools.trim-shapes');
    expect(off).toMatchObject({ enabled: true, active: false, label: 'Trim Shapes' });
    const on = commandById(
      buildAppCommands(baseCtx({ trimShapesActive: true })),
      'tools.trim-shapes',
    );
    expect(on.active).toBe(true);
  });

  it('turns the Trim tool on, and off again from the menu', () => {
    const context = vectorCutCommandContext(useStore.getState());
    expect(context.trimShapesActive).toBe(false);
    context.trimShapes();
    expect(useUiStore.getState().toolMode).toEqual({ kind: 'trim-shapes' });
    expect(vectorCutCommandContext(useStore.getState()).trimShapesActive).toBe(true);
    context.trimShapes();
    expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
  });
});
