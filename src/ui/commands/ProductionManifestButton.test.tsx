import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { fixtureState, NOW, renderFixture } from '../state/variable-array-test-fixture';
import { resetStore } from '../state/test-helpers';
import { ProductionManifestButton } from './ProductionManifestButton';

vi.mock('../app/platform-context', () => ({
  usePlatform: () => ({}),
  usePlatformOptional: () => null,
}));
vi.mock('../app/confirm-discard', () => ({ confirmDiscardAsync: async () => true }));
vi.mock('../text/render-variable-text', () => ({
  renderVariableText: async (input: Parameters<typeof renderFixture>[0]) => renderFixture(input),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null,
  host: HTMLDivElement | null = null;
beforeEach(() => {
  resetStore();
  useStore.setState(fixtureState());
});
afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});
function button(text: string): HTMLButtonElement {
  const found = [...host!.querySelectorAll('button')].find((item) => item.textContent === text);
  if (found === undefined) throw new Error('Missing ' + text);
  return found;
}
async function mount(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<ProductionManifestButton />));
  await act(async () => Simulate.click(button('Production run…')));
}
describe('production variant review controls', () => {
  it('refreshes result selection after capture and identifies the explicitly inspected row', async () => {
    useStore.getState().createProductionRun('Badges', 2, NOW);
    await mount();
    await act(async () => Simulate.click(button('Inspect row 1')));
    await act(async () => Simulate.click(button('Open fixed row artwork')));
    await act(async () => Simulate.click(button('Capture working variant')));
    const selector = host!.querySelector<HTMLSelectElement>(
      '[aria-label="Production row result"]',
    )!;
    expect(selector.value).toBe('reviewed');
    expect(host!.querySelector('legend')?.textContent).toContain('Row 1');
    await act(async () => {
      selector.value = 'completed';
      Simulate.change(selector);
    });
    await act(async () => Simulate.click(button('Record result')));
    expect(useStore.getState().project.productionManifest?.rows.map((row) => row.status)).toEqual([
      'completed',
      'pending',
    ]);
  });
});
