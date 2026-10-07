import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { PlatformProvider } from '../../app/platform-context';
import type { PlatformAdapter } from '../../../platform/types';
import { useLaserStore } from '../../state/laser-store';
import { DiagnosticBundleReviewPanel } from './DiagnosticBundleReview';

vi.mock('../../app/build-info', () => ({
  buildGcodeMetadata: () => ({
    appName: 'KerfDesk',
    appVersion: '1.2',
    gitSha: 'abcd1234',
    buildTimeUtc: '2026-10-07T00:00:00Z',
    emitterRevision: '1',
  }),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

it('exports the reviewed bytes despite live state changes and never queries the controller', async () => {
  const write = vi.fn(async () => undefined);
  const read = vi.spyOn(useLaserStore.getState(), 'readMachineSettings');
  const send = vi.spyOn(useLaserStore.getState(), 'sendConsoleCommand');
  const platform: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => ({ displayName: 'diagnostics.json', write }),
    serial: { isSupported: () => true, requestPort: async () => null },
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <PlatformProvider adapter={platform}>
          <DiagnosticBundleReviewPanel />
        </PlatformProvider>,
      ),
    );
    const button = (text: string) =>
      [...host.querySelectorAll('button')].find((item) => item.textContent === text);
    expect(button('Save reviewed JSON')?.disabled).toBe(true);
    await act(async () => button('Review diagnostic bundle')?.click());
    const reviewed = host.querySelector('textarea')?.value;
    expect(reviewed).toContain('kerfdesk.diagnostic-bundle');
    const original = useLaserStore.getState().transcript;
    await act(async () => useLaserStore.setState({ transcript: [] }));
    await act(async () => button('Save reviewed JSON')?.click());
    expect(write).toHaveBeenCalledWith(reviewed);
    expect(read).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Nothing was sent');
    useLaserStore.setState({ transcript: original });
  } finally {
    await act(async () => root.unmount());
  }
});
