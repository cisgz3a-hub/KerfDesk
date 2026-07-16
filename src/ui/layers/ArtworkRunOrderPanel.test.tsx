import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { ArtworkRunOrderPanel } from './ArtworkRunOrderPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = '';
  resetStore();
  useUiStore.getState().finishArtworkNumbering();
  useUiStore.getState().setArtworkRunFocus(null);
  useUiStore.getState().setCutsLayersView('layers');
});

describe('ArtworkRunOrderPanel', () => {
  it('focuses a run unit and moves it by exact number', async () => {
    importArtwork('Johann');
    importArtwork('Box');
    useStore.getState().selectObject(null);
    const host = await renderPanel();
    const johann = rowByLabel(host, 'Run 1: Johann');
    await act(async () => johann.click());
    expect(useStore.getState().selectedObjectId).toBe('Johann');
    expect(useUiStore.getState().artworkRunFocus).toMatchObject({
      objectIds: ['Johann'],
      position: 1,
    });
    await act(async () => useStore.getState().selectObject('Box'));
    expect(useUiStore.getState().artworkRunFocus).toMatchObject({
      objectIds: ['Box'],
      position: 2,
    });
    expect(rowByLabel(host, 'Run 2: Box').getAttribute('aria-current')).toBe('true');

    const input = host.querySelector('input[aria-label="Run position for Box"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Box position input missing');
    await act(async () => {
      input.value = '1';
      Simulate.blur(input);
    });
    expect(useStore.getState().project.scene.artworkOrder).toEqual(['Box', 'Johann']);
    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
      'Johann',
      'Box',
    ]);
  });

  it('shows intentionally unified artwork as one numbered run unit', async () => {
    importArtwork('Johann');
    importArtwork('Box');
    const sharedOperation = useStore.getState().project.scene.layers[0]!.id;
    useStore.setState({ selectedObjectId: 'Johann', additionalSelectedIds: new Set(['Box']) });
    useStore.getState().useOperationForSelection(sharedOperation);
    const host = await renderPanel();

    expect(host.querySelectorAll('article[aria-label^="Run "]')).toHaveLength(1);
    expect(host.textContent).toContain('One shared run unit');
    expect(host.textContent).toContain('Johann + 1 more');
  });

  it('virtualizes a 50-job list and starts one canvas-numbering interaction', async () => {
    for (let index = 1; index <= 50; index += 1) importArtwork(`Job ${index}`);
    useStore.getState().selectObject(null);
    const host = await renderPanel();

    expect(host.textContent).toContain('50 run units');
    const renderedRows = host.querySelectorAll('article[aria-label^="Run "]');
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(50);

    const numberOnCanvas = buttonByText(host, 'Number on canvas');
    await act(async () => numberOnCanvas.click());
    expect(useUiStore.getState().artworkNumbering).toMatchObject({
      kind: 'active',
      nextPosition: 1,
    });
    expect(useStore.getState().pendingUndo).not.toBeNull();
  });

  it('undoes within numbering, commits Done once, and restores Cancel', async () => {
    importArtwork('A');
    importArtwork('B');
    importArtwork('C');
    useStore.getState().selectObject(null);
    const host = await renderPanel();
    await act(async () => buttonByText(host, 'Number on canvas').click());
    await act(async () => {
      useStore.getState().setArtworkOrderDuringInteraction(['B', 'A', 'C']);
      useUiStore.getState().recordArtworkNumbering('B', ['B', 'A', 'C'], {
        objectIds: ['B'],
        position: 1,
        color: '#dc2626',
      });
    });
    await act(async () => buttonByText(host, 'Undo last').click());
    expect(useStore.getState().project.scene.artworkOrder).toEqual(['A', 'B', 'C']);

    await act(async () => {
      useStore.getState().setArtworkOrderDuringInteraction(['B', 'A', 'C']);
      useUiStore.getState().recordArtworkNumbering('B', ['B', 'A', 'C'], {
        objectIds: ['B'],
        position: 1,
        color: '#dc2626',
      });
    });
    const undoBeforeDone = useStore.getState().undoStack.length;
    await act(async () => buttonByText(host, 'Done').click());
    expect(useStore.getState().undoStack).toHaveLength(undoBeforeDone + 1);
    expect(useStore.getState().project.scene.artworkOrder).toEqual(['B', 'A', 'C']);

    await act(async () => buttonByText(host, 'Number on canvas').click());
    await act(async () => {
      useStore.getState().setArtworkOrderDuringInteraction(['C', 'B', 'A']);
      useUiStore.getState().recordArtworkNumbering('C', ['C', 'B', 'A'], {
        objectIds: ['C'],
        position: 1,
        color: '#16a34a',
      });
    });
    await act(async () => buttonByText(host, 'Cancel').click());
    expect(useStore.getState().project.scene.artworkOrder).toEqual(['B', 'A', 'C']);
  });
});

async function renderPanel(): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  host.style.height = '700px';
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<ArtworkRunOrderPanel />));
  return host;
}

function importArtwork(id: string): void {
  useStore.getState().importSvgObject(svgObj(id, ['#000000']));
}

function rowByLabel(host: HTMLElement, label: string): HTMLElement {
  const row = host.querySelector(`article[aria-label="${label}"]`);
  if (!(row instanceof HTMLElement)) throw new Error(`${label} row missing`);
  return row;
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button missing`);
  return button;
}
