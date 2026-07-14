import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore as reset } from '../state/test-helpers';
import { JobControls } from './JobControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  reset();
});

describe('JobControls output scope controls', () => {
  it('keeps compile placement editable while machine commands are disconnected', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () => root.render(<JobControls disabled onStartJob={() => undefined} />));
      expect(select(host, 'Start from').disabled).toBe(false);
      expect(button(host, 'Start job')).toHaveProperty('disabled', true);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('renders Cut Selected Graphics and gates Use Selection Origin by placement mode', async () => {
    useStore.setState({ jobPlacement: { startFrom: 'absolute', anchor: 'front-left' } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
      });

      const cutSelected = input(host, 'Cut Selected Graphics');
      const useSelectionOrigin = input(host, 'Use Selection Origin');
      expect(cutSelected.checked).toBe(false);
      expect(useSelectionOrigin.disabled).toBe(true);

      await act(async () => {
        cutSelected.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(useStore.getState().outputScopeSettings.cutSelectedGraphics).toBe(true);
      expect(input(host, 'Use Selection Origin').disabled).toBe(true);

      await act(async () => {
        useStore.getState().setJobPlacement({ startFrom: 'current-position' });
      });
      expect(input(host, 'Use Selection Origin').disabled).toBe(false);
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });
});

function input(host: HTMLElement, label: string): HTMLInputElement {
  const found = host.querySelector(`input[aria-label="${label}"]`);
  if (!(found instanceof HTMLInputElement)) {
    throw new Error(`Expected input: ${label}`);
  }
  return found;
}

function select(host: HTMLElement, label: string): HTMLSelectElement {
  const found = host.querySelector(`select[aria-label="${label}"]`);
  if (!(found instanceof HTMLSelectElement)) throw new Error(`Expected select: ${label}`);
  return found;
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Expected button: ${label}`);
  return found;
}
