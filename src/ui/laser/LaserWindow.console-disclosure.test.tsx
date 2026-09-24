import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useLaserStore } from '../state/laser-store';
import { outboundTranscriptEntry } from '../state/laser-transcript';
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
      expect(disclosure?.contains(button(host, 'Start'))).toBe(false);

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
  // second during a job. Behind a closed summary it holds what it last showed,
  // and it stays mounted so closing the section never loses an unsent draft.
  it('holds the transcript while closed and keeps the unsent draft', async () => {
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
      const input = details.querySelector('input[aria-label="Console command"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('Console command not mounted');

      await act(async () =>
        useLaserStore.setState({
          transcript: [outboundTranscriptEntry(1, 0, 'G0 X12.5', 'console')],
        }),
      );
      expect(details.textContent).not.toContain('G0 X12.5');

      await toggle(summary);
      expect(details.textContent).toContain('G0 X12.5');
      await act(async () => typeInto(input, '$G'));
      await toggle(summary);
      await toggle(summary);
      expect(details.querySelector('input[aria-label="Console command"]')).toBe(input);
      expect(input.value).toBe('$G');
      expect(details.contains(button(host, 'Super console'))).toBe(true);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      useLaserStore.setState({ transcript: [] });
      host.remove();
    }
  });
});

function typeInto(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

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
