import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installChromiumSavePicker,
  type ChromiumSavePicker,
} from '../../platform/web/chromium-save-picker.test-support';
import { webAdapter } from '../../platform/web/web-adapter';
import { PlatformProvider } from '../app/platform-context';
import { InspectorStockSave, STL_SUGGESTED_NAME } from './InspectorStockSave';
import type { StockStl } from './stock-stl';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let picker: ChromiumSavePicker | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  picker?.restore();
  picker = null;
});

async function clickSaveAsStl(stl: () => Promise<StockStl | null>): Promise<HTMLDivElement> {
  const element = document.createElement('div');
  host = element;
  document.body.appendChild(element);
  root = createRoot(element);
  await act(async () =>
    root?.render(
      <PlatformProvider adapter={webAdapter}>
        <InspectorStockSave stl={stl} />
      </PlatformProvider>,
    ),
  );
  const button = element.querySelector('button');
  if (button === null) throw new Error('Save as STL button missing');
  await act(async () => button.click());
  return element;
}

// Audit 19-P2-1 / ADR-656: Chromium empties the chosen file as its save picker
// returns, so the solid is made before the picker opens.
describe('Inspector Save as STL over an existing file', () => {
  it('keeps the old STL when nothing of the stock is left, without opening the picker', async () => {
    const disk = new Map([[STL_SUGGESTED_NAME, 'previous solid']]);
    picker = installChromiumSavePicker(disk);

    const element = await clickSaveAsStl(async () => null);

    expect(element.textContent).toContain('Nothing of the stock is left to save.');
    expect(picker.picks()).toBe(0);
    expect(disk.get(STL_SUGGESTED_NAME)).toBe('previous solid');
  });

  it('writes the solid once the destination is chosen', async () => {
    const disk = new Map([[STL_SUGGESTED_NAME, 'previous solid']]);
    picker = installChromiumSavePicker(disk);
    const bytes = new TextEncoder().encode('solid stock').buffer;

    const element = await clickSaveAsStl(async () => ({ bytes, triangles: 12 }));

    expect(picker.picks()).toBe(1);
    await vi.waitFor(() => expect(disk.get(STL_SUGGESTED_NAME)).toBe('solid stock'));
    await vi.waitFor(() => expect(element.textContent).toContain(`Saved ${STL_SUGGESTED_NAME}`));
  });
});
