import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

vi.mock('./font-loader', () => ({
  cssFamilyForFont: (key: string) => `lf2-${key}`,
  ensureFontCss: vi.fn(async () => undefined),
}));

import { FontPicker } from './FontPicker';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('shows the four OFL CNC fonts with previews drawn from their machining paths', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(<FontPicker value="roboto-regular" onChange={() => undefined} />),
    );
    const trigger = host.querySelector('button[aria-haspopup="listbox"]');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('Font picker trigger missing');
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(host.textContent).toContain('Relief SingleLine');
    await waitForPreviewPaths(host);

    for (const name of [
      'Relief SingleLine',
      'EMS Nixish',
      'EMS Decorous Script',
      'EMS Casual Hand',
    ]) {
      expect(host.textContent).toContain(name);
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

async function waitForPreviewPaths(host: HTMLElement): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (host.querySelectorAll('svg path[d]:not([d=""])').length === 4) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  expect(host.querySelectorAll('svg path[d]:not([d=""])')).toHaveLength(4);
}
