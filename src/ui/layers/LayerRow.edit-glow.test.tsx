// An operation row's More controls act on that operation alone, so focus there
// lights exactly its artwork with the edit glow, and the row's own pulse,
// which widens to same-settings operations, steps aside (ADR-646 Amendment 1).
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createLayer, createProject, type SceneObject } from '../../core/scene';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { PULSE_HOVER_DWELL_MS } from '../workspace/artwork-pulse';
import { LayerRow } from './LayerRow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  useUiStore.setState({ editedArtwork: null, hoveredOperationId: null });
  document.body.replaceChildren();
});

// Two operations with the same settings: the row pulse would light both.
function loadFixture(focusTest = false): void {
  const edited = {
    ...createLayer({ id: 'edited', color: '#000000' }),
    ...(focusTest ? { focusTest: { offsetMm: 0.5, travelFeedMmPerMin: 600 } } : {}),
  };
  const twin = createLayer({ id: 'twin', color: '#2563eb' });
  const objects: SceneObject[] = [
    { ...svgObj('first', ['#000000']), operationIds: ['edited'] },
    { ...svgObj('second', ['#000000']), operationIds: ['edited'] },
    { ...svgObj('lookalike', ['#2563eb']), operationIds: ['twin'] },
  ];
  useStore.setState({
    project: { ...createProject(), scene: { objects, layers: [edited, twin] } },
  });
}

function Row(): JSX.Element | null {
  const layer = useStore((state) =>
    state.project.scene.layers.find((candidate) => candidate.id === 'edited'),
  );
  return layer === undefined ? null : <LayerRow layer={layer} canMoveUp={false} canMoveDown />;
}

async function mount() {
  const outside = document.createElement('button');
  const host = document.createElement('div');
  document.body.append(outside, host);
  const root = createRoot(host);
  await act(async () => root.render(<Row />));
  const row = host.querySelector<HTMLElement>('section[aria-label^="Operation "]');
  host.querySelector('details')?.setAttribute('open', '');
  const find = <T extends Element>(selector: string): T => {
    const element = host.querySelector<T>(selector);
    if (element === null) throw new Error(`${selector} missing`);
    return element;
  };
  if (row === null) throw new Error('operation row missing');
  return {
    row,
    outside,
    output: find<HTMLInputElement>('input[aria-label^="Include in output"]'),
    activate: find<HTMLButtonElement>('button[aria-label^="Activate operation"]'),
    selectArtwork: find<HTMLButtonElement>('.lf-operation-menu button[aria-label^="Select"]'),
    unmount: async () => act(async () => root.unmount()),
  };
}

// React derives pointerenter/leave from pointerover/out with a related target.
async function pointer(type: 'pointerover' | 'pointerout', target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: document.body }));
  });
}

const settle = (): Promise<void> =>
  act(async () => new Promise((resolve) => setTimeout(resolve, PULSE_HOVER_DWELL_MS + 30)));
const edited = () => useUiStore.getState().editedArtwork;
const hovered = () => useUiStore.getState().hoveredOperationId;
const lit = {
  owner: 'operation-row:edited',
  objectIds: ['first', 'second'],
  operationIds: ['edited'],
};

describe('operation row edit glow', () => {
  it("lights exactly its operation's artwork while focus is in the row's menu", async () => {
    loadFixture();
    const view = await mount();

    await act(async () => view.output.focus());
    await settle();
    expect(edited()).toEqual(lit);
    expect(hovered()).toBeNull();

    // A change keeps the same glow; the canvas pulses again for the change.
    const before = edited();
    await act(async () => view.output.click());
    expect(useStore.getState().project.scene.layers[0]?.output).toBe(false);
    await act(async () => view.selectArtwork.focus());
    expect(edited()).toBe(before);

    // Plain focus on the row brings back the row pulse.
    await act(async () => view.activate.focus());
    expect(edited()).toBeNull();
    await settle();
    expect(hovered()).toBe('edited');

    await act(async () => view.outside.focus());
    expect(hovered()).toBeNull();
    expect(edited()).toBeNull();
    await view.unmount();
  });

  it('steps the row pulse aside for its own edit, even under the pointer', async () => {
    loadFixture();
    const view = await mount();
    await pointer('pointerover', view.row);
    await settle();
    expect(hovered()).toBe('edited');

    await act(async () => view.output.focus());
    expect(hovered()).toBeNull();
    expect(edited()).toEqual(lit);

    // The pointer settling on the row again does not take the canvas back.
    await pointer('pointerout', view.row);
    await pointer('pointerover', view.row);
    await settle();
    expect(hovered()).toBeNull();
    expect(edited()).toEqual(lit);

    // A press outside ends the edit; with no blur after it, right after the press.
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(edited()).toBeNull();
    await view.unmount();
    expect(hovered()).toBeNull();
  });

  it('lights all artwork from Show only, which changes every operation', async () => {
    loadFixture();
    const view = await mount();
    const showOnly = view.row.querySelector<HTMLButtonElement>('button[aria-label^="Show only"]');
    await act(async () => showOnly?.focus());
    expect(edited()).toEqual({
      owner: 'operation-row:edited',
      objectIds: ['first', 'second', 'lookalike'],
      operationIds: ['edited', 'twin'],
    });
    await act(async () => view.output.focus());
    expect(edited()).toEqual(lit);
    await view.unmount();
  });

  it('lights its operation from Remove Focus Test Z, and ends once the button is gone', async () => {
    loadFixture(true);
    const view = await mount();
    const remove = [...view.row.querySelectorAll('button')].find(
      (button) => button.textContent === 'Remove Focus Test Z',
    );
    if (remove === undefined) throw new Error('Remove Focus Test Z missing');
    await act(async () => remove.focus());
    await settle();
    expect(edited()).toEqual(lit);
    expect(hovered()).toBeNull();

    // The button removes itself and takes focus with it, without a blur.
    await act(async () => remove.click());
    expect(useStore.getState().project.scene.layers[0]?.focusTest).toBeUndefined();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(edited()).toBeNull();
    await view.unmount();
  });

  it('ends the glow when the row goes away', async () => {
    loadFixture();
    const view = await mount();
    await act(async () => view.output.focus());
    expect(edited()).toEqual(lit);
    await view.unmount();
    expect(edited()).toBeNull();
  });
});
