import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { handlePenShortcut } from './pen-shortcuts';

function keydown(
  key: string,
  init: { readonly shiftKey?: boolean; readonly ctrlKey?: boolean; readonly repeat?: boolean } = {},
  target?: HTMLElement,
): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  if (target !== undefined) Object.defineProperty(e, 'target', { value: target });
  return e;
}

function startDraft(points: ReadonlyArray<{ readonly x: number; readonly y: number }>): void {
  useUiStore.getState().setPenDraft({ nodes: points.map((point) => ({ kind: 'corner', point })) });
}

beforeEach(() => {
  useStore.getState().newProject();
  useUiStore.getState().resetToolMode();
  useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
});

describe('pen shortcuts (ADR-380)', () => {
  it('S switches the next node between corner and smooth', () => {
    const e = keydown('s');

    expect(handlePenShortcut(e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(useUiStore.getState().penNodeMode).toBe('smooth');

    handlePenShortcut(keydown('S'));
    expect(useUiStore.getState().penNodeMode).toBe('corner');
  });

  it('a held S toggles once', () => {
    handlePenShortcut(keydown('s'));
    expect(handlePenShortcut(keydown('s', { repeat: true }))).toBe(true);

    expect(useUiStore.getState().penNodeMode).toBe('smooth');
  });

  it('Backspace and Delete remove the newest node, then the path', () => {
    startDraft([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);

    expect(handlePenShortcut(keydown('Backspace'))).toBe(true);
    expect(useUiStore.getState().penDraft?.nodes).toHaveLength(1);
    expect(handlePenShortcut(keydown('Delete'))).toBe(true);
    expect(useUiStore.getState().penDraft).toBeNull();
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
  });

  it('leaves Backspace to the edit shortcuts when nothing is being drawn', () => {
    expect(handlePenShortcut(keydown('Backspace'))).toBe(false);
  });

  it('Escape finishes the open path', () => {
    startDraft([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    const e = keydown('Escape');

    expect(handlePenShortcut(e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
  });

  it('lets Escape cancel as before when there is nothing to finish', () => {
    startDraft([{ x: 0, y: 0 }]);
    const e = keydown('Escape');

    expect(handlePenShortcut(e)).toBe(false);
    expect(e.defaultPrevented).toBe(false);
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
  });

  it('stays out of text fields, modified keys and other tools', () => {
    const input = document.createElement('input');
    expect(handlePenShortcut(keydown('s', {}, input))).toBe(false);
    expect(handlePenShortcut(keydown('s', { ctrlKey: true }))).toBe(false);
    expect(handlePenShortcut(keydown('s', { shiftKey: true }))).toBe(false);

    useUiStore.getState().resetToolMode();
    expect(handlePenShortcut(keydown('s'))).toBe(false);
    expect(useUiStore.getState().penNodeMode).toBe('corner');
  });

  it('a new pen session starts in corner mode', () => {
    handlePenShortcut(keydown('s'));

    useUiStore.getState().resetToolMode();
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });

    expect(useUiStore.getState().penNodeMode).toBe('corner');
  });
});
