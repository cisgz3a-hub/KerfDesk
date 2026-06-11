import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { JogPad } from './JogPad';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom's selector engine mis-parses '+' inside quoted attribute values, so
// queries scan getAttribute instead of using querySelector.
function buttonByLabel(host: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label) ?? null
  );
}

async function renderJogPad(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<JogPad disabled={false} />);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  useStore.getState().newProject();
});

// Phase-0 discoverability: the arrow buttons were bare glyphs with no
// accessible name and no tooltip — screen readers announced "button" and
// sighted users had no step feedback.
describe('JogPad accessible labels', () => {
  it('labels each arrow with its direction and the current step', async () => {
    const { host, unmount } = await renderJogPad();

    expect(buttonByLabel(host, 'Jog +Y 10 mm')).not.toBeNull();
    expect(buttonByLabel(host, 'Jog -Y 10 mm')).not.toBeNull();
    expect(buttonByLabel(host, 'Jog -X 10 mm')).not.toBeNull();
    expect(buttonByLabel(host, 'Jog +X 10 mm')).not.toBeNull();

    await unmount();
  });

  it('updates the labels when the step changes', async () => {
    const { host, unmount } = await renderJogPad();

    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Jog step size"]');
    if (select === null) throw new Error('step select missing');
    await act(async () => {
      select.value = '1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(buttonByLabel(host, 'Jog +Y 1 mm')).not.toBeNull();

    await unmount();
  });
});
