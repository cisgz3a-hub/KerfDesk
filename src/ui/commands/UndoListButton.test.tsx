import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { withUndoStepName } from '../state/undo-step-names';
import { UndoListButton } from './UndoListButton';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(): Promise<HTMLButtonElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<UndoListButton />));
  const button = host.querySelector('button[aria-label="Undo list"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error('Undo list button missing');
  return button;
}

function draw(id: string): void {
  const spec = { widthMm: 5, heightMm: 5, cornerRadiusMm: 0 };
  useStore.getState().drawShape(createRectangle({ id, color: '#000000', spec }));
}

function rows(): ReadonlyArray<HTMLButtonElement> {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [data-undo-steps]')];
}

beforeEach(resetStore);

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  resetStore();
});

describe('UndoListButton', () => {
  it('is disabled, with a reason, while there is nothing to undo', async () => {
    const button = await render();
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('nothing to undo');
  });

  it('lists the last 15 steps by name, newest first, and jumps back to the picked one', async () => {
    for (let index = 0; index < 17; index += 1) draw(`r${index}`);
    const last = useStore.getState().project.scene.objects.at(-1);
    if (last === undefined) throw new Error('no objects');
    withUndoStepName('Align Left', () =>
      useStore.getState().applyObjectTransform(last.id, { ...last.transform, x: 40 }),
    );
    const button = await render();
    expect(button.disabled).toBe(false);
    await act(async () => button.click());

    const items = rows();
    expect(items).toHaveLength(15);
    expect(items[0]?.textContent).toBe('Align Left');
    expect(items[1]?.textContent).toBe('Add rectangle2 steps');
    expect(items.map((item) => Number(item.dataset['undoSteps']))).toEqual(
      Array.from({ length: 15 }, (_, index) => index + 1),
    );
    for (const item of items) expect(item.title).not.toBe('');
    expect(document.body.textContent).toContain('3 older steps are in Window → Undo History.');

    await act(async () => items[2]?.click());
    const state = useStore.getState();
    expect(state.undoStack).toHaveLength(15);
    expect(state.redoStack).toHaveLength(3);
    expect(document.querySelector('[role="menu"]')).toBeNull();

    // Redo still walks forward after the jump.
    await act(async () => state.redo());
    expect(useStore.getState().redoStack).toHaveLength(2);
  });
});
