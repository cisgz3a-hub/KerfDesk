import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from './platform-context';
import { PwaUpdateWatcherGate } from './PwaUpdateWatcherGate';

// Mock the gated child so the test verifies only the gate's mount decision, not
// PwaUpdateWatcher's own service-worker/store wiring (covered by its own test).
vi.mock('./PwaUpdateWatcher', () => ({
  PwaUpdateWatcher: () => <div data-testid="pwa-update-watcher" />,
}));

// The gate reads only adapter.id; a partial cast keeps the test focused on the
// mount decision rather than the full PlatformAdapter surface.
function adapterWithId(id: PlatformAdapter['id']): PlatformAdapter {
  return { id } as PlatformAdapter;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: ReactNode): void {
  act(() => root.render(node));
}

function watcherMounted(): boolean {
  return container.querySelector('[data-testid="pwa-update-watcher"]') !== null;
}

describe('PwaUpdateWatcherGate', () => {
  it('does not mount the PWA update watcher on the desktop shell', () => {
    render(
      <PlatformProvider adapter={adapterWithId('electron')}>
        <PwaUpdateWatcherGate />
      </PlatformProvider>,
    );
    expect(watcherMounted()).toBe(false);
  });

  it('mounts the PWA update watcher on the web target', () => {
    render(
      <PlatformProvider adapter={adapterWithId('web')}>
        <PwaUpdateWatcherGate />
      </PlatformProvider>,
    );
    expect(watcherMounted()).toBe(true);
  });

  it('mounts on the web target when no platform provider is present', () => {
    render(<PwaUpdateWatcherGate />);
    expect(watcherMounted()).toBe(true);
  });
});
