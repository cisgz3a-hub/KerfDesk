import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from './platform-context';
import { PwaUpdatePromptGate } from './PwaUpdatePromptGate';

// Mock the gated child so the test verifies only the gate's mount decision, not
// PwaUpdatePrompt's own service-worker/store wiring (covered by its own test).
vi.mock('./PwaUpdatePrompt', () => ({
  PwaUpdatePrompt: () => <div data-testid="pwa-update-prompt" />,
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

function promptMounted(): boolean {
  return container.querySelector('[data-testid="pwa-update-prompt"]') !== null;
}

describe('PwaUpdatePromptGate', () => {
  it('does not mount the PWA update prompt on the desktop shell', () => {
    render(
      <PlatformProvider adapter={adapterWithId('electron')}>
        <PwaUpdatePromptGate />
      </PlatformProvider>,
    );
    expect(promptMounted()).toBe(false);
  });

  it('mounts the PWA update prompt on the web target', () => {
    render(
      <PlatformProvider adapter={adapterWithId('web')}>
        <PwaUpdatePromptGate />
      </PlatformProvider>,
    );
    expect(promptMounted()).toBe(true);
  });

  it('mounts on the web target when no platform provider is present', () => {
    render(<PwaUpdatePromptGate />);
    expect(promptMounted()).toBe(true);
  });
});
