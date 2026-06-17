import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { MeasuredScanOffsetApply } from './MeasuredScanOffsetApply';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderMeasuredApply(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<MeasuredScanOffsetApply />);
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
  resetStore();
});

describe('MeasuredScanOffsetApply', () => {
  it('saves measured scan offsets to the active device profile', async () => {
    const { host, unmount } = await renderMeasuredApply();
    try {
      await changeInput(host, 'Measured offset 1', '-0.05');
      await changeInput(host, 'Measured offset 3', '0.18');
      await changeInput(host, 'Measured speed 3', '3000');

      await act(async () => {
        button(host, 'Apply measured offsets').click();
      });

      expect(useStore.getState().project.device.scanningOffsets).toEqual([
        { speedMmPerMin: 1000, offsetMm: -0.05 },
        { speedMmPerMin: 3000, offsetMm: 0.18 },
      ]);
      expect(useStore.getState().dirty).toBe(true);
    } finally {
      await unmount();
    }
  });

  it('starts from existing calibrated offsets when reopening the panel', async () => {
    useStore.getState().updateDeviceProfile({
      scanningOffsets: [
        { speedMmPerMin: 2500, offsetMm: 0.12 },
        { speedMmPerMin: 5000, offsetMm: 0.2 },
      ],
    });

    const { host, unmount } = await renderMeasuredApply();
    try {
      expect(input(host, 'Measured speed 1').value).toBe('2500');
      expect(input(host, 'Measured offset 1').value).toBe('0.12');
      expect(input(host, 'Measured speed 2').value).toBe('5000');
      expect(input(host, 'Measured offset 2').value).toBe('0.2');
    } finally {
      await unmount();
    }
  });
});

async function changeInput(host: HTMLElement, label: string, value: string): Promise<void> {
  const field = input(host, label);
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}

function input(host: HTMLElement, label: string): HTMLInputElement {
  const match = host.querySelector(`input[aria-label="${label}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`Input not rendered: ${label}`);
  return match;
}
