import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { runStandaloneCncPreflight } from '../../core/preflight';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { partitionSavePreflight } from '../app/save-preflight-policy';
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

// Renders the panel and clicks Save, returning the write mock so a test can
// assert whether the file was actually written.
async function renderAndSave(project: ReturnType<typeof createProject>): Promise<{
  write: ReturnType<typeof vi.fn>;
}> {
  const write = vi.fn(async (_data: string | Blob) => undefined);
  const platform: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: vi.fn(async () => ({ displayName: 'surfacing.nc', write })),
    serial: { isSupported: () => false, requestPort: async () => null },
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
  const saveButton = [...(host?.querySelectorAll('button') ?? [])].find((button) =>
    button.textContent?.includes('Save surfacing G-code'),
  );
  if (saveButton === undefined) throw new Error('save surfacing button missing');
  await act(async () => {
    saveButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { write };
}

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
    expect(data).toContain('; emitter: adr-235-4040-quality-controlled-v2');
    expect(data.indexOf('G0 Z3.810')).toBeLessThan(data.indexOf('M3 S12000'));
    expect(data).toContain('F500.000');
    expect(data).not.toContain('F2500.000');
  });

  // Rule 7 / ADR-228: an enabled no-go zone makes runStandaloneCncPreflight
  // emit 'no-go-zone-collision' unconditionally (standalone-cnc-preflight.ts:80-90).
  // That is a policy code, not compile integrity, so it must warn instead of
  // refusing the export. Before the partitionSavePreflight split this panel read
  // preflight.ok raw and refused the save outright, writing nothing — so this
  // test fails against the pre-change implementation.
  it('saves despite a no-go-zone advisory and reports it as a warning toast', async () => {
    const project = {
      ...createProject({
        ...DEFAULT_DEVICE_PROFILE,
        maxFeed: 500,
        noGoZones: [
          { id: 'clamp', name: 'Front clamp', enabled: true, x: 0, y: 0, width: 20, height: 20 },
        ],
      }),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
    };

    const { write } = await renderAndSave(project);

    // The decisive assertion: the file is written even though preflight.ok is false.
    expect(write).toHaveBeenCalledOnce();
    const warnings = useToastStore.getState().toasts.filter((toast) => toast.variant === 'warning');
    expect(warnings.some((toast) => toast.message.includes('no-go zones'))).toBe(true);
  });

  // Pins the exact pre/post delta without needing the old code present: for this
  // input runStandaloneCncPreflight reports ok === false, yet contributes no
  // compile-integrity issue at all. The old `if (!emitted.preflight.ok) return;`
  // therefore refused the save on it; the partition does not. Revert the panel to
  // reading .ok raw and the test above goes red while this one stays green —
  // together they pin why the partition is required.
  it('reports ok===false for a finding that is advisory, not compile integrity', () => {
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      noGoZones: [
        { id: 'clamp', name: 'Front clamp', enabled: true, x: 0, y: 0, width: 20, height: 20 },
      ],
    };
    const preflight = runStandaloneCncPreflight(
      device,
      DEFAULT_CNC_MACHINE_CONFIG,
      'G1 X1 Y1 F100',
    );

    expect(preflight.ok).toBe(false);
    expect(preflight.issues.some((issue) => issue.code === 'no-go-zone-collision')).toBe(true);
    expect(partitionSavePreflight(preflight.issues).blocking).toEqual([]);
  });
});
