import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from '../../state/laser-store';
import type { SerialTranscriptEntry } from '../../state/laser-transcript';
import { SuperConsoleLauncher } from './SuperConsoleLauncher';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function transcriptEntry(
  id: number,
  overrides: Partial<SerialTranscriptEntry> = {},
): SerialTranscriptEntry {
  return {
    id,
    at: id,
    direction: 'in',
    raw: `ok-${id}`,
    kind: 'ok',
    source: 'controller',
    ...overrides,
  };
}

async function renderLauncher(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<SuperConsoleLauncher />);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

async function openDialog(host: HTMLDivElement): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>('button');
  expect(button?.textContent).toBe('Super console');
  await act(async () => {
    button?.click();
  });
}

function visibleRows(): number {
  const log = document.body.querySelector('[aria-label="Super console transcript"]');
  return log === null ? -1 : log.querySelectorAll(':scope > div').length;
}

afterEach(() => {
  useLaserStore.setState({
    transcript: [],
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('SuperConsoleLauncher / SuperConsoleDialog', () => {
  it('opens the dialog and shows the full transcript, beyond the docked 150-entry cap', async () => {
    const entries = Array.from({ length: 201 }, (_, i) => transcriptEntry(i + 1));
    useLaserStore.setState({ transcript: entries } as Partial<
      ReturnType<typeof useLaserStore.getState>
    >);
    const { host, unmount } = await renderLauncher();
    await openDialog(host);
    expect(document.body.querySelector('.lf-dialog-backdrop')).not.toBeNull();
    expect(visibleRows()).toBe(201);
    await unmount();
  });

  it('hides a group when its filter chip is unchecked', async () => {
    useLaserStore.setState({
      transcript: [
        transcriptEntry(1, { kind: 'error', raw: 'error:9' }),
        transcriptEntry(2),
        transcriptEntry(3, { kind: 'welcome', raw: "Grbl 1.1h ['$' for help]" }),
      ],
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderLauncher();
    await openDialog(host);
    expect(visibleRows()).toBe(3);
    const errorChip = Array.from(document.body.querySelectorAll('label'))
      .find((label) => label.textContent === 'Errors')
      ?.querySelector('input');
    await act(async () => {
      errorChip?.click();
    });
    expect(visibleRows()).toBe(2);
    expect(document.body.textContent).not.toContain('error:9');
    await unmount();
  });

  it('narrows the list with the search box', async () => {
    useLaserStore.setState({
      transcript: [
        transcriptEntry(1, { kind: 'setting', raw: '$32=1' }),
        transcriptEntry(2, { kind: 'setting', raw: '$120=500' }),
        transcriptEntry(3),
      ],
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderLauncher();
    await openDialog(host);
    const search = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Search console lines"]',
    );
    expect(search).not.toBeNull();
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setValue?.call(search, '$120');
      search?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(visibleRows()).toBe(1);
    expect(document.body.textContent).toContain('$120=500');
    await unmount();
  });

  it('closes via the Close button', async () => {
    const { host, unmount } = await renderLauncher();
    await openDialog(host);
    const close = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Close',
    );
    await act(async () => {
      close?.click();
    });
    expect(document.body.querySelector('.lf-dialog-backdrop')).toBeNull();
    await unmount();
  });
});
