import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { DesktopEditorsButton } from './DesktopEditorsButton';
import { getStudioStatus, type StudioStatus } from './artcraft-api';
vi.mock('./artcraft-api', () => ({ getStudioStatus: vi.fn() }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  vi.clearAllMocks();
});
async function render(desktop: boolean): Promise<void> {
  host = document.createElement('div');
  document.body.append(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(
      <PlatformProvider
        adapter={
          {
            id: desktop ? 'electron' : 'web',
            ...(desktop ? { desktopWindow: {} } : {}),
          } as PlatformAdapter
        }
      >
        <DesktopEditorsButton />
      </PlatformProvider>,
    );
  });
}
it.each([false, true])(
  'shows the preview entry only when explicitly available=%s',
  async (available) => {
    vi.mocked(getStudioStatus).mockResolvedValue({ available } as StudioStatus);
    await render(true);
    expect(host?.textContent?.includes('Desktop editors')).toBe(available);
  },
);
it('does not query native editor status in the browser', async () => {
  await render(false);
  expect(getStudioStatus).not.toHaveBeenCalled();
  expect(host?.textContent).toBe('');
});
it('ignores status returned after unmount', async () => {
  let resolve: (value: StudioStatus) => void = () => undefined;
  vi.mocked(getStudioStatus).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render(true);
  await act(async () => root?.unmount());
  root = undefined;
  await act(async () => resolve({ available: true } as StudioStatus));
  expect(host?.textContent).toBe('');
});
