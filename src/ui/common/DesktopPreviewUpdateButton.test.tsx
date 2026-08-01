import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StreamerState } from '../../core/controllers/grbl';
import type {
  DesktopUpdateAdapter,
  DesktopUpdateAvailability,
  PlatformAdapter,
} from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useLaserStore } from '../state/laser-store';
import { DesktopPreviewUpdateButton } from './DesktopPreviewUpdateButton';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const initialStreamer = useLaserStore.getState().streamer;

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = '';
  useLaserStore.setState({ ...useLaserStore.getState(), streamer: initialStreamer });
});

function platform(availability: DesktopUpdateAvailability): PlatformAdapter {
  const desktopUpdates: DesktopUpdateAdapter = {
    downloadPageUrl: (version) =>
      `https://github.com/cisgz3a-hub/KerfDesk/releases/tag/v${version}`,
    checkForUpdate: vi.fn(() => Promise.resolve(availability)),
  };
  return { id: 'electron', desktopUpdates } as PlatformAdapter;
}

async function render(availability: DesktopUpdateAvailability): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <PlatformProvider adapter={platform(availability)}>
        <DesktopPreviewUpdateButton />
      </PlatformProvider>,
    );
  });
  return host;
}

describe('DesktopPreviewUpdateButton', () => {
  it('stays visually absent when no newer Preview exists', async () => {
    const host = await render({ kind: 'none' });
    expect(host.querySelector('a')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('announces and links a newer Preview to the fixed official page', async () => {
    const host = await render({ kind: 'available', version: '1.2.3-preview.5' });
    const link = host.querySelector<HTMLAnchorElement>('a');
    expect(link?.textContent).toBe('Download update');
    expect(link?.getAttribute('href')).toBe(
      'https://github.com/cisgz3a-hub/KerfDesk/releases/tag/v1.2.3-preview.5',
    );
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noreferrer');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('1.2.3-preview.5');
  });

  it('remains passive and available while a machine job is active', async () => {
    useLaserStore.setState({
      ...useLaserStore.getState(),
      streamer: { ...initialStreamer, status: 'streaming' } as StreamerState,
    });
    const host = await render({ kind: 'available', version: '1.2.3-preview.5' });
    expect(host.querySelector('a')).not.toBeNull();
  });
});
