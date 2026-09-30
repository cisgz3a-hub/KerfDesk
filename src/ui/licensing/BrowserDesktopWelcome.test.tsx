import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolveWindowsDesktopDownload } from '../../../public/desktop-windows-download.mjs';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';
import { BrowserDesktopWelcome, BROWSER_WELCOME_KEY } from './BrowserDesktopWelcome';
import { DesktopWelcomeDialog } from './DesktopWelcomeDialog';
import { DesktopDownloadContext } from './desktop-download-context';

vi.mock('../../../public/desktop-windows-download.mjs', () => ({
  resolveWindowsDesktopDownload: vi.fn(),
}));

const initialLaser = useLaserStore.getState();
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  localStorage.removeItem(BROWSER_WELCOME_KEY);
  useUiStore.setState({ modalDepth: 0 });
  useLaserStore.setState({ ...initialLaser, streamer: null, fireActive: false });
  vi.mocked(resolveWindowsDesktopDownload).mockReset();
  vi.mocked(resolveWindowsDesktopDownload).mockResolvedValue({
    status: 'unavailable',
    reason: 'not-released',
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const render = root.render.bind(root);
  root.render = (children) =>
    render(
      <DesktopDownloadContext.Provider value={resolveWindowsDesktopDownload}>
        {children}
      </DesktopDownloadContext.Provider>,
    );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.removeItem(BROWSER_WELCOME_KEY);
  useLaserStore.setState(initialLaser);
  useUiStore.setState({ modalDepth: 0 });
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const dialog = () => host.querySelector('[role="dialog"]');
const button = (text: string) =>
  [...host.querySelectorAll('button')].find((item) => item.textContent?.includes(text))!;
async function tick(): Promise<void> {
  await act(async () => vi.advanceTimersByTimeAsync(800));
}

it('offers Free on the first visit, remembers it and does not fetch on a later visit', async () => {
  const closed = vi.fn();
  await act(async () => root.render(<BrowserDesktopWelcome requested={false} onClose={closed} />));
  expect(dialog()).toBeNull();
  await tick();
  expect(dialog()).not.toBeNull();
  expect(document.activeElement).toBe(dialog());
  expect(button('Download coming soon').disabled).toBe(true);
  expect(button('Continue with Free').disabled).toBe(false);
  await act(async () => button('Continue with Free').click());
  expect(dialog()).toBeNull();
  expect(localStorage.getItem(BROWSER_WELCOME_KEY)).toBe('dismissed');
  expect(closed).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  await act(async () => root.render(<BrowserDesktopWelcome requested={false} onClose={closed} />));
  await tick();
  expect(dialog()).toBeNull();
  expect(resolveWindowsDesktopDownload).toHaveBeenCalledOnce();
});

it('can be reopened explicitly after dismissal and Escape chooses Free', async () => {
  localStorage.setItem(BROWSER_WELCOME_KEY, 'dismissed');
  const close = vi.fn();
  await act(async () => root.render(<BrowserDesktopWelcome requested onClose={close} />));
  expect(dialog()).not.toBeNull();
  await act(async () =>
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(close).toHaveBeenCalledOnce();
});

it('waits while another modal is open and dismisses if machine activity begins', async () => {
  useUiStore.setState({ modalDepth: 1 });
  const close = vi.fn();
  await act(async () => root.render(<BrowserDesktopWelcome requested={false} onClose={close} />));
  await tick();
  expect(dialog()).toBeNull();
  expect(resolveWindowsDesktopDownload).not.toHaveBeenCalled();
  await act(async () => useUiStore.setState({ modalDepth: 0 }));
  await tick();
  expect(dialog()).not.toBeNull();
  await act(async () => useLaserStore.setState({ fireActive: true }));
  expect(dialog()).toBeNull();
  expect(close).toHaveBeenCalledOnce();
});

it('lets users continue when storage is denied', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  const close = vi.fn();
  await act(async () => root.render(<BrowserDesktopWelcome requested={false} onClose={close} />));
  await tick();
  await act(async () => button('Continue with Free').click());
  expect(dialog()).toBeNull();
  expect(close).toHaveBeenCalledOnce();
});

it('only exposes the verified direct installer after resolution, without triggering it', async () => {
  let complete!: (value: Awaited<ReturnType<typeof resolveWindowsDesktopDownload>>) => void;
  vi.mocked(resolveWindowsDesktopDownload).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const close = vi.fn();
  await act(async () => root.render(<DesktopWelcomeDialog onClose={close} />));
  expect(button('Checking download').disabled).toBe(true);
  expect(host.querySelector('a')).toBeNull();
  await act(async () =>
    complete({
      status: 'ready',
      version: '1.2.3',
      url: 'https://dl.kerfdesk.com/desktop/commercial/releases/1.2.3/KerfDesk-1.2.3-windows-x64-setup.exe',
      fileName: 'KerfDesk-1.2.3-windows-x64-setup.exe',
      bytes: 123,
      sha256: 'a'.repeat(64),
      publishedAt: '2026-09-30T00:00:00.000Z',
      codeSigning: 'signed',
      updates: 'automatic',
    }),
  );
  const link = host.querySelector('a')!;
  expect(link.download).toBe('KerfDesk-1.2.3-windows-x64-setup.exe');
  expect(link.href).toContain('/releases/1.2.3/');
  expect(link.rel).toBe('noopener noreferrer');
  expect(close).not.toHaveBeenCalled();
});

it('offers retry for a failed check while Free stays available and aborts on close', async () => {
  vi.mocked(resolveWindowsDesktopDownload).mockResolvedValueOnce({
    status: 'error',
    reason: 'network',
  });
  await act(async () => root.render(<DesktopWelcomeDialog onClose={() => undefined} />));
  expect(button('Continue with Free').disabled).toBe(false);
  await act(async () => button('Try again').click());
  expect(resolveWindowsDesktopDownload).toHaveBeenCalledTimes(2);
  expect(button('Download coming soon').disabled).toBe(true);
  const lastOptions = vi.mocked(resolveWindowsDesktopDownload).mock.calls[1]![0]!;
  await act(async () => root.render(null));
  expect(lastOptions.signal?.aborted).toBe(true);
});

it('discloses an unsigned commercial download and manual updates before the user clicks', async () => {
  vi.mocked(resolveWindowsDesktopDownload).mockResolvedValue({
    status: 'ready',
    version: '1.2.3',
    url: 'https://dl.kerfdesk.com/desktop/commercial-manual/releases/1.2.3/KerfDesk-1.2.3-windows-x64-setup.exe',
    fileName: 'KerfDesk-1.2.3-windows-x64-setup.exe',
    bytes: 123,
    sha256: 'a'.repeat(64),
    publishedAt: '2026-09-30T00:00:00.000Z',
    codeSigning: 'unsigned',
    updates: 'manual',
  });
  const close = vi.fn();
  await act(async () => root.render(<DesktopWelcomeDialog onClose={close} />));
  expect(host.querySelector('a')?.href).toContain('/commercial-manual/');
  expect(host.textContent).toContain('Unsigned installer');
  expect(host.textContent).toContain('Updates need your approval');
  expect(host.textContent).toContain('unknown publisher warning');
  expect(close).not.toHaveBeenCalled();
});
