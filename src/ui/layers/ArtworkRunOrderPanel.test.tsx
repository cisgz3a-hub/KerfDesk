import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { ArtworkRunOrderPanel } from './ArtworkRunOrderPanel';
import { ArtworkNumberingPrompt } from '../workspace/ArtworkNumberingPrompt';

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
  it.each(['mounted', 'retired'] as const)(
    'does not let a %s panel clear numbering started in the replacement document',
    async (mode) => {
      importArtwork('Previous');
      const host = await renderPanel();
      await act(async () => buttonByText(host, 'Number on canvas').click());
      const previous = useStore.getState().project;
      const loaded = {
        ...previous,
        scene: { ...previous.scene, objects: [svgObj('Next', ['#000000'])] },
      };
      const retiringRoot = mode === 'retired' ? roots.pop() : undefined;
      await act(async () => {
        useStore.getState().setProject(loaded);
        useStore.getState().beginInteraction();
        useUiStore.getState().startArtworkNumbering(['Next']);
        useUiStore.getState().setArtworkRunFocus({
          objectIds: ['Next'],
          position: 1,
          color: '#000000',
        });
        retiringRoot?.unmount();
      });

      expect(useStore.getState().project.scene.objects[0]?.id).toBe('Next');
      expect(useStore.getState().pendingUndo?.project.scene.objects[0]?.id).toBe('Next');
      expect(useUiStore.getState().artworkNumbering).toMatchObject({
        kind: 'active',
        nextPosition: 1,
      });
      expect(useUiStore.getState().artworkRunFocus?.objectIds).toEqual(['Next']);
    },
  );

  it('retires numbering when New replaces the document while the panel stays mounted', async () => {
    importArtwork('Previous');
    const host = await renderPanel();
    await act(async () => buttonByText(host, 'Number on canvas').click());
    expect(useStore.getState().pendingUndo).not.toBeNull();
    expect(host.textContent).toContain('Click artwork for run #1');

    await act(async () => useStore.getState().newProject());

    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().pendingUndo).toBeNull();
    expect(useUiStore.getState().artworkNumbering.kind).toBe('idle');
    expect(useUiStore.getState().artworkRunFocus).toBeNull();
    expect(host.textContent).not.toContain('Click artwork for run');
    expect(host.textContent).toContain('Import or draw artwork');
  });

  it('retires the old numbering owner on Open without restoring the previous document', async () => {
    importArtwork('Previous');
    const previous = useStore.getState().project;
    const loaded = {
      ...previous,
      scene: { ...previous.scene, objects: [svgObj('Next', ['#000000'])] },
    };
    const host = await renderPanel();
    await act(async () => buttonByText(host, 'Number on canvas').click());
    await act(async () => useStore.getState().setProject(loaded));

    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual(['Next']);
    expect(useStore.getState().pendingUndo).toBeNull();
    expect(useUiStore.getState().artworkNumbering.kind).toBe('idle');
    expect(host.querySelector('[aria-label="Canvas numbering controls"]')).toBeNull();
    await act(async () => buttonByText(host, 'Number on canvas').click());
    expect(useUiStore.getState().artworkNumbering).toMatchObject({
      kind: 'active',
      nextPosition: 1,
    });
    expect(useStore.getState().pendingUndo?.project.scene.objects[0]?.id).toBe('Next');
  });

  it('keeps Cancel available when the same numbering document becomes empty', async () => {
    importArtwork('Previous');
    const host = await renderPanel();
    await act(async () => buttonByText(host, 'Number on canvas').click());
    await act(async () => useStore.getState().removeSceneObject('Previous'));

    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(host.querySelector('[aria-label="Canvas numbering controls"]')).not.toBeNull();
    await act(async () => buttonByText(host, 'Cancel').click());
    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
      'Previous',
    ]);
    expect(useUiStore.getState().artworkNumbering.kind).toBe('idle');
  });

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
    expect(host.textContent).toContain('Shared by 2 artworks');
    expect(host.textContent).toContain('Johann + 1 more');
  });

  it('virtualizes a 50-job list and starts one canvas-numbering interaction', async () => {
    for (let index = 1; index <= 50; index += 1) importArtwork(`Job ${index}`);
    useStore.getState().selectObject(null);
    const host = await renderPanel();

    expect(host.textContent).toContain('50 runs');
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

  it('keeps original run numbers while searching and recovers from no matches', async () => {
    importArtwork('Johann');
    importArtwork('Box');
    const host = await renderPanel();
    const input = host.querySelector('input[type="search"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Search input missing');
    await act(async () => {
      input.value = 'Box';
      Simulate.change(input);
    });
    expect(host.querySelectorAll('article')).toHaveLength(1);
    expect(rowByLabel(host, 'Run 2: Box')).not.toBeNull();
    expect(host.textContent).toContain('1 of 2 runs');
    await act(async () => {
      input.value = 'No matching name';
      Simulate.change(input);
    });
    expect(host.textContent).toContain('No matching artwork');
    await act(async () => buttonByText(host, 'Show all runs').click());
    expect(host.querySelectorAll('article')).toHaveLength(2);
    expect(input.value).toBe('');
  });

  it('reveals all runs and keeps edits out of an active numbering session', async () => {
    importArtwork('A');
    importArtwork('B');
    const host = await renderPanel();
    const input = host.querySelector('input[type="search"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Search input missing');
    await act(async () => {
      input.value = 'B';
      Simulate.change(input);
    });
    await act(async () => buttonByText(host, 'Number on canvas').click());
    expect(host.querySelectorAll('article')).toHaveLength(2);
    expect(host.textContent).toContain('0 of 2 assigned');
    expect(buttonByText(host, 'Undo last').disabled).toBe(true);
    for (const input of host.querySelectorAll<HTMLInputElement>('article input')) {
      expect(input.disabled).toBe(true);
    }
    expect(buttonByText(host, 'Edit settings').disabled).toBe(true);
    await act(async () => buttonByText(host, 'Cancel').click());
    expect(buttonByText(host, 'Edit settings').disabled).toBe(false);
  });

  it('offers a keyboard-accessible show action and opens settings for that run', async () => {
    importArtwork('Johann');
    importArtwork('Box');
    useStore.getState().selectObject(null);
    useUiStore.getState().setCutsLayersView('run-order');
    const host = await renderPanel();
    const show = host.querySelector<HTMLButtonElement>('button[aria-label="Select Box"]');
    if (show === null) throw new Error('Show artwork button missing');
    await act(async () => show.click());
    expect(useStore.getState().selectedObjectId).toBe('Box');
    const box = rowByLabel(host, 'Run 2: Box');
    await act(async () => buttonByText(box, 'Edit settings').click());
    expect(useUiStore.getState().cutsLayersView).toBe('layers');
    expect(useStore.getState().selectedObjectId).toBe('Box');
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
  await act(async () =>
    root.render(
      <>
        <ArtworkRunOrderPanel />
        <ArtworkNumberingPrompt />
      </>,
    ),
  );
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
