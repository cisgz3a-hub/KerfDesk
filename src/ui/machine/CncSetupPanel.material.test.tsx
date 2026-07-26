// CncSetupPanel project-material selector (ADR-112): the Material & Bit panel
// shows a "Project material" dropdown in CNC mode, and picking one drives the
// applyCncStockMaterial action (stock material + layer feeds).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncSetupPanel } from './CncSetupPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};

afterEach(() => resetStore());

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  useStore.getState().setMachineKind('cnc');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <PlatformProvider adapter={mockPlatform}>
        <CncSetupPanel />
      </PlatformProvider>,
    );
  });
  return { host, root };
}

function materialSelect(host: HTMLElement): HTMLSelectElement {
  const select = host.querySelector('select[aria-label="Project material"]');
  if (!(select instanceof HTMLSelectElement)) throw new Error('material select missing');
  return select;
}

function stockMaterial(): string | undefined {
  const machine = useStore.getState().project.machine;
  return machine?.kind === 'cnc' ? machine.stock.materialKey : undefined;
}

describe('CncSetupPanel project material (ADR-112)', () => {
  it('renders grouped wood species alongside the general material families', async () => {
    const { host, root } = await render();
    try {
      const values = [...materialSelect(host).options].map((o) => o.value);
      expect(values).toContain(''); // Custom
      expect(values).toContain('hardwood');
      expect(values).toContain('hardwood-walnut');
      expect(values).toContain('softwood-pine');
      expect(values).toContain('plywood-mdf');
      expect(
        [...materialSelect(host).querySelectorAll('optgroup')].map((group) => group.label),
      ).toContain('Hardwoods');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('previews a species without changing the project, then applies it explicitly', async () => {
    const { host, root } = await render();
    try {
      const select = materialSelect(host);
      select.value = 'hardwood-walnut';
      await act(async () => {
        Simulate.change(select);
      });
      expect(stockMaterial()).toBeUndefined();
      expect(host.textContent).toContain('Walnut uses the hardwood starting model');
      const apply = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Apply Walnut preset'),
      );
      if (!(apply instanceof HTMLButtonElement)) throw new Error('apply button missing');
      await act(async () => {
        Simulate.click(apply);
      });
      expect(stockMaterial()).toBe('hardwood-walnut');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
