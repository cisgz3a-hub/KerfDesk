import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { SiteLinks } from './SiteLinks';

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
        <SiteLinks />
      </PlatformProvider>,
    );
  });
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SiteLinks', () => {
  it('links the pricing page and the three policies, each in a new tab', async () => {
    const host = await renderInProvider('web');
    const links = [...host.querySelectorAll('nav[aria-label="KerfDesk pricing and policies"] a')];
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Pricing', 'https://kerfdesk.com/pricing/'],
      ['Terms', 'https://kerfdesk.com/terms/'],
      ['Privacy', 'https://kerfdesk.com/privacy/'],
      ['Refunds', 'https://kerfdesk.com/refunds/'],
    ]);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('is hidden inside the desktop app, which lists them under Help', async () => {
    const host = await renderInProvider('electron');
    expect(host.querySelector('nav')).toBeNull();
  });
});
