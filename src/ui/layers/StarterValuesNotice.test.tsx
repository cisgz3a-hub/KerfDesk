import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../core/scene';
import { useUiStore } from '../state/ui-store';
import { StarterValuesNotice, usesStarterValues } from './StarterValuesNotice';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => useUiStore.getState().closeMaterialTestDialog());

describe('starter values notice (ADR-500 Amendment 1 decision 5)', () => {
  it('marks a new operation, and nothing chosen for a material', () => {
    const layer = createLayer({ id: 'L1', color: '#ff0000' });

    expect(usesStarterValues(layer)).toBe(true);
    expect(usesStarterValues({ ...layer, power: 45 })).toBe(false);
    expect(usesStarterValues({ ...layer, passes: 2 })).toBe(false);
    expect(
      usesStarterValues({
        ...layer,
        materialBinding: {
          libraryId: 'lib',
          presetId: 'card',
          lastResolved: layer,
        },
      }),
    ).toBe(false);
  });

  it('opens Tools → Material Test', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<StarterValuesNotice />));

    expect(host.textContent).toContain('Starter values, not a recipe.');
    await act(async () => host.querySelector('button')?.click());

    expect(useUiStore.getState().materialTestDialogOpen).toBe(true);
    await act(async () => root.unmount());
    host.remove();
  });
});
