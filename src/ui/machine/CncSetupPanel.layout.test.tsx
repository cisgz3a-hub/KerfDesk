// CncSetupPanel narrow-rail layout: each Row's value column must be able to
// shrink (min-width:0) so a long <select> option — e.g. a full bit name like
// "3.175 mm (1/8\") end mill" — truncates in place instead of forcing the
// column wider than the rail, whose ResizablePanel wrapper clips overflow with
// no scrollbar (the box's right edge would otherwise vanish off-screen).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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

function selectByLabel(host: HTMLElement, label: string): HTMLSelectElement {
  const select = host.querySelector(`select[aria-label="${label}"]`);
  if (!(select instanceof HTMLSelectElement)) throw new Error(`${label} select missing`);
  return select;
}

// React serializes a numeric 0 as "0" (no unit); jsdom keeps it verbatim, so
// accept either spelling of a zero length.
function isZeroLength(value: string): boolean {
  return value === '0' || value === '0px';
}

describe('CncSetupPanel narrow-rail layout', () => {
  it('lets the value column of a <select> row shrink so the box cannot clip off the rail', async () => {
    const { host, root } = await render();
    try {
      for (const label of ['Active bit', 'Project material', 'Coolant']) {
        const select = selectByLabel(host, label);
        // The select opts into shrink…
        expect(isZeroLength(select.style.minWidth)).toBe(true);
        // …but the fix is on its value-column wrapper: without min-width:0 there,
        // the wrapper's default min-width:auto pins it to the select's intrinsic
        // width and the rail clips the overflow.
        const valueColumn = select.parentElement;
        expect(valueColumn).toBeInstanceOf(HTMLDivElement);
        expect(isZeroLength((valueColumn as HTMLDivElement).style.minWidth)).toBe(true);
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
