import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { DownloadDesktopLink } from './DownloadDesktopLink';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function adapter(id: PlatformAdapter['id']): PlatformAdapter {
  return {
    id,
    pickFilesForOpen: vi.fn(async () => []),
    pickFileForSave: vi.fn(async () => null),
    serial: { isSupported: () => false, requestPort: vi.fn(async () => null) },
  };
}

async function renderInProvider(id: PlatformAdapter['id']): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    createRoot(host).render(
      <PlatformProvider adapter={adapter(id)}>
        <DownloadDesktopLink />
      </PlatformProvider>,
    );
  });
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DownloadDesktopLink', () => {
  it('links to the static download page in a new tab in the browser', async () => {
    const host = await renderInProvider('web');
    const link = host.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/download');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.textContent).toBe('Download for Windows');
  });

  it('is hidden inside the desktop app (id=electron)', async () => {
    const host = await renderInProvider('electron');
    expect(host.querySelector('a')).toBeNull();
  });
});
