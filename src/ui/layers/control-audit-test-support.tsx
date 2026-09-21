import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { resetStore, svgObj } from '../state/test-helpers';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { useTutorialStore } from '../tutorials/tutorial-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const roots: { root: Root; host: HTMLDivElement }[] = [];
export const auditPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};
beforeEach(() => {
  resetStore();
  useUiStore.getState().setRailPanelVisible('layers', true);
  useUiStore.getState().setCutsLayersView('layers');
  useUiStore.getState().setArtworkRunFocus(null);
  useUiStore.getState().finishArtworkNumbering();
  useTutorialStore.setState({ isOpen: false, tutorialId: null });
});
afterEach(async () => {
  for (const view of roots.splice(0)) {
    await act(async () => view.root.unmount());
    view.host.remove();
  }
  resetStore();
  vi.restoreAllMocks();
});
export async function mount(node: ReactNode, platform = auditPlatform): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push({ root, host });
  await act(async () =>
    root.render(<PlatformProvider adapter={platform}>{node}</PlatformProvider>),
  );
  return host;
}
export function button(host: ParentNode, label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) =>
      element.getAttribute('aria-label') === label || element.textContent?.trim() === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
export function input(host: ParentNode, selector: string): HTMLInputElement {
  const result = host.querySelector<HTMLInputElement>(selector);
  if (!result) throw new Error(`Missing input: ${selector}`);
  return result;
}
export async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
}
export async function change(
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
): Promise<void> {
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}
export function arrangeTwo(): void {
  // eslint-disable-next-line no-restricted-syntax -- Scene-data colours for imported artwork fixtures, not UI chrome.
  useStore.getState().importSvgObject(svgObj('First', ['#ff0000']));
  // eslint-disable-next-line no-restricted-syntax -- Scene-data colours for imported artwork fixtures, not UI chrome.
  useStore.getState().importSvgObject(svgObj('Second', ['#0000ff']));
}
export function layer(index = 0) {
  const target = useStore.getState().project.scene.layers[index];
  if (target === undefined) throw new Error(`Missing audit fixture layer ${index}`);
  return target;
}
