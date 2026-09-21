import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { PlatformProvider } from '../app/platform-context';
import { saveSurfacingProgram } from './save-surfacing-program';
import { SurfacingPanel } from './SurfacingPanel';

vi.mock('./save-surfacing-program', () => ({ saveSurfacingProgram: vi.fn() }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('audit Cancel surfacing save aborts the active preparation and retires progress without committing a file', async () => {
  let signal: AbortSignal | null = null;
  vi.mocked(saveSurfacingProgram).mockImplementation(async (args) => {
    signal = args.signal;
    await new Promise<void>((_resolve, reject) =>
      args.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }),
    );
  });
  const pickFileForSave = vi.fn(async () => null);
  const platform = {
    id: 'mock' as const,
    pickFileForSave,
    pickFilesForOpen: async () => [],
    serial: { isSupported: () => false, requestPort: async () => null },
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <PlatformProvider adapter={platform}>
          <SurfacingPanel machine={DEFAULT_CNC_MACHINE_CONFIG} />
        </PlatformProvider>,
      ),
    );
    const button = (text: string) =>
      [...host.querySelectorAll('button')].find((node) => node.textContent === text)!;
    await act(async () => button('Save surfacing G-code…').click());
    expect(signal).not.toBeNull();
    expect((signal as AbortSignal | null)?.aborted).toBe(false);
    await act(async () => button('Cancel surfacing save').click());
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(button('Cancel surfacing save')).toBeUndefined();
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(pickFileForSave).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
