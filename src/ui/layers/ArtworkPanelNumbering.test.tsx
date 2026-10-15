import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { CutsLayersPanel } from './CutsLayersPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  resetStore();
  useUiStore.getState().resetArtworkRunOrder();
  useUiStore.getState().setRailPanelVisible('layers', true);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  resetStore();
  useUiStore.getState().resetArtworkRunOrder();
  useUiStore.getState().setCutsLayersView('layers');
});

describe('Artwork panel numbering ownership', () => {
  it.each(['Done', 'Cancel'])(
    'keeps organiser edits outside canvas numbering until %s',
    async (finish) => {
      seedIndependentArtwork();
      useUiStore.getState().setCutsLayersView('run-order');
      const host = await renderPanel();
      await act(async () => buttonByText(host, 'Number on canvas').click());
      const launcher = buttonByText(host, 'Objects');
      expect(launcher.disabled).toBe(true);
      await act(async () => launcher.click());
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      await act(async () => buttonByText(host, finish).click());
      expect(launcher.disabled).toBe(false);
      await act(async () => launcher.click());
      const dialog = required<HTMLElement>(document.body, '[role="dialog"]');
      await act(async () =>
        required<HTMLButtonElement>(dialog, 'button[aria-label^="Rename "]').click(),
      );
      const input = required<HTMLInputElement>(dialog, 'input[aria-label="Design name"]');
      await act(async () => {
        input.value = 'Saved name';
        Simulate.change(input);
      });
      await act(async () => buttonByText(dialog, 'Save name').click());
      await act(async () => buttonByText(dialog, 'Done').click());
      await act(async () => buttonByText(host, 'Number on canvas').click());
      await act(async () => buttonByText(host, 'Cancel').click());
      expect(
        useStore.getState().project.scene.objects.some((object) => object.name === 'Saved name'),
      ).toBe(true);
    },
  );
});

function seedIndependentArtwork(): void {
  for (const id of ['chosen', 'peer']) useStore.getState().importSvgObject(svgObj(id, ['#000000']));
  useStore.getState().selectObject('chosen');
  useStore.setState({ undoStack: [], redoStack: [], dirty: false });
}

function required<T extends HTMLElement>(host: HTMLElement, selector: string): T {
  const element = host.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing ${selector}`);
  return element;
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (button === undefined) throw new Error(`Missing ${text}`);
  return button;
}

async function renderPanel(): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <PlatformProvider adapter={mockPlatform()}>
        <CutsLayersPanel />
      </PlatformProvider>,
    ),
  );
  return host;
}
