import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { operationIdsForObject } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { CutsLayersPanel } from './CutsLayersPanel';
import { arrangeTwo, button, change, click, layer, mount } from './control-audit-test-support';

async function openDisclosure(host: HTMLElement, label: string): Promise<void> {
  const summary = [...host.querySelectorAll('summary')].find((element) =>
    element.textContent?.trim().startsWith(label),
  );
  const details = summary?.closest('details');
  if (summary === undefined || details == null) throw new Error(`Missing disclosure: ${label}`);
  if (!details.open) await click(summary);
}

function operationsOf(objectId: string): ReadonlyArray<string> {
  const { objects, layers } = useStore.getState().project.scene;
  const object = objects.find((item) => item.id === objectId);
  return object === undefined ? [] : operationIdsForObject(object, layers);
}

function row(host: HTMLElement, name: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`section[aria-label="Operation ${name}"]`);
  if (found === null) throw new Error(`Missing operation row ${name}`);
  return found;
}

async function panelWithSecondSelected(): Promise<HTMLElement> {
  arrangeTwo();
  useStore.getState().selectObject('Second');
  const host = await mount(<CutsLayersPanel />);
  await openDisclosure(host, 'All operations');
  return host;
}

describe('operations panel: moving the selection onto an operation', () => {
  it('offers Move selection here on other operations and moves in one undo step', async () => {
    const host = await panelWithSecondSelected();
    const first = layer();
    const undoBefore = useStore.getState().undoStack.length;

    expect(row(host, 'Second').textContent).toContain('Selected artwork uses this operation');
    await click(button(row(host, 'First'), `Move selected artwork to ${first.name}`));

    expect(operationsOf('Second')).toEqual([first.id]);
    expect(useStore.getState().project.scene.layers.map((item) => item.id)).toEqual([first.id]);
    expect(useStore.getState().undoStack).toHaveLength(undoBefore + 1);
  });

  it('moves the selection when the target operation’s colour is chosen', async () => {
    const host = await panelWithSecondSelected();
    const first = layer();

    await click(button(row(host, 'First'), `${first.name} colour: move selected artwork here`));

    expect(operationsOf('Second')).toEqual([first.id]);
    expect(useUiStore.getState().activeLayerColor).not.toBe(first.color);
  });

  it('with nothing selected, a colour picks the drawing operation and no row offers a move', async () => {
    arrangeTwo();
    useStore.getState().selectObject(null);
    const host = await mount(<CutsLayersPanel />);
    await openDisclosure(host, 'All operations');
    const first = layer();

    const moveButtons = [...host.querySelectorAll('button')].filter((element) =>
      element.textContent?.includes('Move selection here'),
    );
    expect(moveButtons).toEqual([]);
    await click(button(row(host, 'First'), `${first.name} colour: draw with this operation`));

    expect(useUiStore.getState().activeLayerColor).toBe(first.color);
    expect(operationsOf('First')).toEqual([first.id]);
  });

  it('moves the inspected artwork from the inspector’s Move to operation', async () => {
    arrangeTwo();
    useStore.getState().selectObject('Second');
    const host = await mount(<CutsLayersPanel />);
    const first = layer();
    const select = host.querySelector<HTMLSelectElement>(
      'select[aria-label="Operation to move artwork to"]',
    );
    if (select === null) throw new Error('Move to operation missing');
    const move = button(host, 'Move');

    expect(move.disabled).toBe(true);
    await change(select, first.id);
    await click(button(host, 'Move'));

    expect(operationsOf('Second')).toEqual([first.id]);
  });
});

describe('operations panel: switches for every operation', () => {
  it('disables, inverts, hides and shows every operation', async () => {
    arrangeTwo();
    const host = await mount(<CutsLayersPanel />);
    await openDisclosure(host, 'All operations');
    await openDisclosure(host, 'Actions for every operation');
    const layers = () => useStore.getState().project.scene.layers;

    expect(host.textContent).toContain('2 of 2 on');
    expect(button(host, 'Enable all').disabled).toBe(true);
    await click(button(host, 'Disable all'));
    expect(layers().map((item) => item.output)).toEqual([false, false]);

    await click(button(host, 'Invert output of every operation'));
    expect(layers().map((item) => item.output)).toEqual([true, true]);

    await click(button(host, 'Hide all'));
    expect(layers().map((item) => item.visible)).toEqual([false, false]);
    await click(button(host, 'Show all'));
    expect(layers().map((item) => item.visible)).toEqual([true, true]);
    await act(async () => useStore.getState().undo());
    expect(layers().map((item) => item.visible)).toEqual([false, false]);
  });
});
