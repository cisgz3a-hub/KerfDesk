import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstallButton } from './InstallButton';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function fireBeforeInstallPrompt(prompt: () => Promise<void>): void {
  const event = new Event('beforeinstallprompt');
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  window.dispatchEvent(event);
}

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<InstallButton />);
  });
  if (root === null) throw new Error('root missing');
  return { host, root };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('InstallButton', () => {
  it('is hidden until the browser offers an install prompt', async () => {
    const { host } = await render();
    expect(host.querySelector('button')).toBeNull();
  });

  it('shows an Install button after beforeinstallprompt fires', async () => {
    const { host } = await render();
    await act(async () => {
      fireBeforeInstallPrompt(vi.fn().mockResolvedValue(undefined));
    });
    expect(host.querySelector('button')?.textContent).toBe('Install app');
  });

  it('prompts the browser and hides itself when clicked', async () => {
    const { host } = await render();
    const prompt = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      fireBeforeInstallPrompt(prompt);
    });
    await act(async () => {
      host.querySelector('button')?.click();
    });
    expect(prompt).toHaveBeenCalled();
    expect(host.querySelector('button')).toBeNull();
  });
});
