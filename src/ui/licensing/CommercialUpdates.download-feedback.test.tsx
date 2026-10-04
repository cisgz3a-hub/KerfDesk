import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommercialUpdateStatus, LicenceAdapter } from '../../platform/types';
import { useCommercialUpdateStore } from '../state/commercial-update-store';
import { CommercialUpdates } from './CommercialUpdates';
import { CHECK_UPDATES_EVENT } from './update-status-text';

let root: Root;
let host: HTMLDivElement;
const available: CommercialUpdateStatus = {
  mode: 'manual',
  state: 'available',
  currentVersion: '1.0.7',
  version: '1.0.8',
  checkedAt: null,
  installOnQuit: false,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useCommercialUpdateStore.setState({ status: null });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useCommercialUpdateStore.setState({ status: null });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function adapter(download: () => Promise<CommercialUpdateStatus>): LicenceAdapter {
  return {
    updateStatus: vi.fn(async () => available),
    checkForUpdates: vi.fn(async () => ({ ...available, state: 'checking' })),
    downloadUpdate: vi.fn(download),
    installUpdateOnQuit: vi.fn(),
    installUpdateAndClose: vi.fn(),
    earlyUpdates: vi.fn(async () => ({ available: false, enabled: false })),
  } as unknown as LicenceAdapter;
}
async function mount(client: LicenceAdapter): Promise<void> {
  await act(async () => root.render(<CommercialUpdates client={client} updatesUntil={null} />));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  await act(async () => window.dispatchEvent(new Event(CHECK_UPDATES_EVENT)));
}
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((item) => item.textContent === label);

it('acknowledges Download immediately while admission is pending, without repeating or installing', async () => {
  let reply!: (value: CommercialUpdateStatus) => void;
  const client = adapter(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  await mount(client);
  await act(async () => {
    button('Download update')!.click();
    button('Download update')!.click();
  });
  expect(host.textContent).toContain('Starting the download...');
  expect(button('Download update')?.disabled).toBe(true);
  expect(client.downloadUpdate).toHaveBeenCalledOnce();
  expect(client.installUpdateOnQuit).not.toHaveBeenCalled();
  expect(client.installUpdateAndClose).not.toHaveBeenCalled();
  await act(async () => reply({ ...available, state: 'downloading' }));
  expect(host.textContent).toContain('Downloading KerfDesk 1.0.8');
});

it('shows measured byte progress and keeps verifying distinct from ready to install', async () => {
  await mount(adapter(async () => ({ ...available, state: 'downloading' })));
  act(() =>
    useCommercialUpdateStore.getState().setStatus({
      ...available,
      state: 'downloading',
      downloadProgress: { phase: 'receiving', receivedBytes: 524_288, totalBytes: 1_048_576 },
    } as CommercialUpdateStatus),
  );
  expect(host.textContent).toContain('50%');
  expect(host.querySelector('progress')?.value).toBe(524_288);
  expect(host.querySelector('progress')?.max).toBe(1_048_576);
  act(() =>
    useCommercialUpdateStore.getState().setStatus({
      ...available,
      state: 'downloading',
      downloadProgress: { phase: 'verifying', receivedBytes: 1_048_576, totalBytes: 1_048_576 },
    } as CommercialUpdateStatus),
  );
  expect(host.textContent).toContain('Verifying download');
  expect(button('Install and close KerfDesk')).toBeUndefined();
  expect(button('Install when I close KerfDesk')).toBeUndefined();
});

it('treats a lost download admission as unknown, then reads active progress before allowing another download', async () => {
  const client = adapter(async () => {
    throw new Error('update response timed out');
  });
  await mount(client);
  vi.mocked(client.updateStatus).mockResolvedValue({ ...available, state: 'downloading' });
  await act(async () => button('Download update')!.click());
  expect(host.textContent).toContain('may still be downloading');
  expect(button('Download update')).toBeUndefined();
  expect(button('Check now')?.disabled).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(3_000));
  expect(host.textContent).toContain('Downloading KerfDesk');
  expect(client.downloadUpdate).toHaveBeenCalledOnce();
  expect(client.installUpdateOnQuit).not.toHaveBeenCalled();
});
