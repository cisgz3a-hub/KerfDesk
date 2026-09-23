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
      expect(disclosure?.contains(button(host, 'Set up & Frame'))).toBe(false);

      await toggle(summary);
      expect((disclosure as HTMLDetailsElement).open).toBe(true);
      expect(disclosure?.querySelector('input[aria-label="Console command"]')).toBeInstanceOf(
        HTMLInputElement,
      );
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  // The docked console follows the transcript, which publishes several times a
  // second during a job. Behind a closed summary it must not be mounted at all.
  it('mounts the docked console only while the section is open', async () => {
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
      const { summary, details } = consoleDisclosure(host);
      expect(details.querySelector('[aria-label="GRBL console"]')).toBeNull();
      expect(details.contains(button(host, 'Super console'))).toBe(true);

      await toggle(summary);
      expect(details.querySelector('[aria-label="GRBL console"]')).toBeInstanceOf(HTMLElement);
      expect(details.querySelector('[aria-label="Docked console commands"]')).toBeInstanceOf(
        HTMLElement,
      );

      await toggle(summary);
      expect(details.open).toBe(false);
      expect(details.querySelector('[aria-label="GRBL console"]')).toBeNull();
      expect(details.contains(button(host, 'Super console'))).toBe(true);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});

// The <details> toggle event is queued as a task after the summary click.
async function toggle(summary: HTMLElement | undefined): Promise<void> {
  await act(async () => {
    summary?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function consoleDisclosure(host: HTMLElement): {
  readonly summary: HTMLElement;
  readonly details: HTMLDetailsElement;
} {
  const summary = [...host.querySelectorAll('summary')].find(
    (candidate) => candidate.textContent === 'Console',
  );
  const details = summary?.parentElement;
  if (summary === undefined || !(details instanceof HTMLDetailsElement)) {
    throw new Error('Console disclosure not rendered');
  }
  return { summary, details };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
