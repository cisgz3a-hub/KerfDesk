import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useLaserStore } from '../state/laser-store';
import { LaserWindow } from './LaserWindow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

afterEach(() => {
  useLaserStore.setState({ connection: { kind: 'disconnected' } } as Partial<
    ReturnType<typeof useLaserStore.getState>
  >);
});

describe('LaserWindow Console disclosure', () => {
  it('keeps the advanced Console collapsed without hiding job controls', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <PlatformProvider adapter={mockPlatform}>
            <LaserWindow />
          </PlatformProvider>,
        );
      });

      const summary = [...host.querySelectorAll('summary')].find(
        (candidate) => candidate.textContent === 'Console',
      );
      const disclosure = summary?.parentElement;
      expect(summary).toBeInstanceOf(HTMLElement);
      expect(disclosure).toBeInstanceOf(HTMLDetailsElement);
      expect((disclosure as HTMLDetailsElement).open).toBe(false);
      expect(disclosure?.querySelector('input[aria-label="Console command"]')).toBeInstanceOf(
        HTMLInputElement,
      );
      expect(disclosure?.contains(button(host, 'Set up & Frame'))).toBe(false);

      await act(async () => summary?.click());
      expect((disclosure as HTMLDetailsElement).open).toBe(true);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
