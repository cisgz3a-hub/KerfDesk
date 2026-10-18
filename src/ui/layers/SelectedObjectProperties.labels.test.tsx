// The inspector names artwork by its own name and keeps the process switch
// still when a click raises a warning (ADR-616).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { SelectedObjectProperties } from './SelectedObjectProperties';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { readonly host: HTMLDivElement; readonly root: Root } | null = null;

afterEach(async () => {
  if (mounted !== null) {
    const { host, root } = mounted;
    await act(async () => root.unmount());
    host.remove();
    mounted = null;
  }
  resetStore();
});

async function render(): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted = { host, root };
  await act(async () => root.render(<SelectedObjectProperties />));
  return host;
}

describe('SelectedObjectProperties labels and warnings', () => {
  it('lists artwork names, not operation names, in the artwork chooser', async () => {
    useStore.getState().importSvgObject(svgObj('cut-outline', ['#000000']));
    useStore.getState().importSvgObject(svgObj('logo', ['#000000']));
    const [first, second] = useStore.getState().project.scene.layers;
    useStore.getState().renameOperation(first!.id, 'Operation 1');
    useStore.getState().renameOperation(second!.id, 'Operation 2');
    useStore.getState().selectObject(null);
    const host = await render();

    const chooser = host.querySelector('select[aria-label="Artwork to inspect"]');
    if (!(chooser instanceof HTMLSelectElement)) throw new Error('artwork chooser missing');
    expect([...chooser.options].map((option) => option.textContent)).toEqual([
      'cut-outline',
      'logo',
    ]);
    expect(host.querySelector('.lf-artwork-context__title strong')?.textContent).toBe(
      'cut-outline',
    );
  });

  it('shows the vector-in-Image warning under the process switch, not above it', async () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#000000']));
    useStore.getState().selectObject('O1');
    const host = await render();
    const image = host.querySelector(
      '[role="radiogroup"][aria-label="Mode for selected objects"] input[value="image"]',
    );
    if (!(image instanceof HTMLInputElement)) throw new Error('Image process missing');
    await act(async () => image.click());

    const processSwitch = host.querySelector('[role="radiogroup"]');
    const warning = [...host.querySelectorAll('p')].find((element) =>
      element.textContent?.startsWith('Vector artwork needs a Line or Fill process'),
    );
    if (processSwitch === null || warning === undefined) throw new Error('switch or warning');
    expect(
      processSwitch.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
