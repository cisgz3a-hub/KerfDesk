import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { SurfacingPanel } from './SurfacingPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  resetStore();
  useLaserStore.setState({ controllerSettings: null });
});

describe('SurfacingPanel save path', () => {
  it('writes a preflighted provenance file with safe-Z before M3 and capped feeds', async () => {
    const write = vi.fn(async (_data: string | Blob) => undefined);
    const pickFileForSave = vi.fn(async () => ({ displayName: 'surfacing.nc', write }));
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [],
      pickFileForSave,
      serial: { isSupported: () => false, requestPort: async () => null },
    };
    const project = {
      ...createProject({ ...DEFAULT_DEVICE_PROFILE, maxFeed: 500 }),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
    };
    useStore.setState({ project });
    useLaserStore.setState({ controllerSettings: null });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <PlatformProvider adapter={platform}>
          <SurfacingPanel machine={DEFAULT_CNC_MACHINE_CONFIG} />
        </PlatformProvider>,
      );
    });
    const saveButton = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Save surfacing G-code'),
    );
    if (saveButton === undefined) throw new Error('save surfacing button missing');
    await act(async () => {
      saveButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(pickFileForSave).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
    const data = write.mock.calls[0]?.[0];
    expect(typeof data).toBe('string');
    if (typeof data !== 'string') throw new Error('expected text output');
    expect(data).toContain('; emitter: adr-234-4040-fill-entry-v1');
    expect(data.indexOf('G0 Z3.810')).toBeLessThan(data.indexOf('M3 S12000'));
    expect(data).toContain('F500.000');
    expect(data).not.toContain('F2500.000');
  });
});
