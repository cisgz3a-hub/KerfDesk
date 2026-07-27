import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type NoGoZone } from '../../core/devices';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
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
  useToastStore.setState({ toasts: [] });
});

const ENABLED_NO_GO_ZONE: NoGoZone = {
  id: 'front-clamp',
  name: 'Front clamp',
  enabled: true,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
};

function mockPlatform(cancelPicker = false): {
  readonly platform: PlatformAdapter;
  readonly write: ReturnType<typeof vi.fn>;
  readonly pickFileForSave: ReturnType<typeof vi.fn>;
} {
  const write = vi.fn(async (_data: string | Blob) => undefined);
  const pickFileForSave = vi.fn(async () =>
    cancelPicker ? null : { displayName: 'surfacing.nc', write },
  );
  return {
    write,
    pickFileForSave,
    platform: {
      id: 'mock',
      pickFilesForOpen: async () => [],
      pickFileForSave,
      serial: { isSupported: () => false, requestPort: async () => null },
    },
  };
}

async function clickSave(
  platform: PlatformAdapter,
  noGoZones: ReadonlyArray<NoGoZone> = [],
): Promise<void> {
  const project = {
    ...createProject({ ...DEFAULT_DEVICE_PROFILE, maxFeed: 500, noGoZones }),
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
}

describe('SurfacingPanel save path', () => {
  it('writes a preflighted provenance file with safe-Z before M3 and capped feeds', async () => {
    const { platform, write, pickFileForSave } = mockPlatform();
    await clickSave(platform);

    expect(pickFileForSave).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
    const data = write.mock.calls[0]?.[0];
    expect(typeof data).toBe('string');
    if (typeof data !== 'string') throw new Error('expected text output');
    expect(data).toContain('; emitter: adr-235-4040-quality-controlled-v2');
    expect(data.indexOf('G0 Z3.810')).toBeLessThan(data.indexOf('M3 S12000'));
    expect(data).toContain('F500.000');
    expect(data).not.toContain('F2500.000');
  });

  // Rule 7 / ADR-228: `no-go-zone-collision` and `out-of-bed` are the two
  // findings the rule names by name as warn-only. runStandaloneCncPreflight
  // raises the no-go-zone uncertainty unconditionally whenever ANY zone is
  // enabled, so refusing on it made the surfacing wizard permanently unable to
  // save — a policy judgement blocking an export, which rule 7 forbids.
  it('saves with a warning instead of refusing when a no-go zone is enabled', async () => {
    const { platform, write, pickFileForSave } = mockPlatform();
    await clickSave(platform, [ENABLED_NO_GO_ZONE]);

    expect(pickFileForSave).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
    const toasts = useToastStore.getState().toasts;
    // The exact fact the refusal used to carry, now as a warning.
    expect(
      toasts.some(
        (toast) =>
          toast.variant === 'warning' &&
          toast.message.includes(
            'Standalone surfacing cannot prove clearance from enabled machine no-go zones',
          ),
      ),
    ).toBe(true);
    expect(toasts.some((toast) => toast.variant === 'error')).toBe(false);
  });

  // The refusal this replaced fired on every save ATTEMPT. Surfacing has no
  // other warning surface, so a cancelled picker must not swallow the finding.
  it('states the no-go-zone finding even when the picker is cancelled', async () => {
    const { platform, write } = mockPlatform(true);
    await clickSave(platform, [ENABLED_NO_GO_ZONE]);

    expect(write).not.toHaveBeenCalled();
    expect(
      useToastStore
        .getState()
        .toasts.some(
          (toast) =>
            toast.variant === 'warning' &&
            toast.message.includes('cannot prove clearance from enabled machine no-go zones'),
        ),
    ).toBe(true);
  });
});
