import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type NoGoZone } from '../../core/devices';
import { runStandaloneCncPreflight } from '../../core/preflight';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { EMITTER_REVISION } from '../../io/gcode';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { partitionSavePreflight } from '../app/save-preflight-policy';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { SurfacingPanel } from './SurfacingPanel';
import type { SurfacingWorkerInput } from './surfacing-worker-protocol';

// Exercise real generation/preflight/chunk output here; client protocol and
// cancellation have separate Worker-harness tests.
vi.mock('./surfacing-worker-client', async () => {
  const { prepareSurfacingStream } = await import('./surfacing-worker-runtime');
  return {
    startSurfacingStream: (input: SurfacingWorkerInput, signal: AbortSignal) => {
      const session = prepareSurfacingStream(input);
      return {
        ready: Promise.resolve(session.prepared),
        chunks: {
          async *[Symbol.asyncIterator]() {
            for (let next = session.chunks.next(); !next.done; next = session.chunks.next()) {
              signal.throwIfAborted();
              yield next.value;
            }
          },
        },
        dispose: vi.fn(),
      };
    },
  };
});

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
  const writeChunks = async (
    chunks: AsyncIterable<string>,
    signal?: AbortSignal,
  ): Promise<void> => {
    let text = '';
    for await (const chunk of chunks) {
      signal?.throwIfAborted();
      text += chunk;
    }
    await write(text);
  };
  const pickFileForSave = vi.fn(async () =>
    cancelPicker ? null : { displayName: 'surfacing.nc', write, writeChunks },
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
  totalDepthMm?: number,
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
  if (totalDepthMm !== undefined) {
    const input = host.querySelector('input[aria-label="Surfacing total depth"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Total depth input missing');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter === undefined) throw new Error('Native input value setter missing');
    await act(async () => {
      setter.call(input, String(totalDepthMm));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
  }
  const saveButton = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Save surfacing G-code'),
  );
  if (saveButton === undefined) throw new Error('save surfacing button missing');
  await act(async () => {
    saveButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('SurfacingPanel stock tracking', () => {
  // The panel prefills the facing area from the stock footprint. Seeded once
  // with useState, it kept the mount-time numbers after the operator changed
  // stock size (or opened another project) and silently faced the wrong area.
  it('re-prefills the facing area when the stock footprint changes', async () => {
    const { platform } = mockPlatform();
    const machine = DEFAULT_CNC_MACHINE_CONFIG;
    useStore.setState({ project: { ...createProject(DEFAULT_DEVICE_PROFILE), machine } });
    host = document.createElement('div');
    document.body.appendChild(host);
    const created = createRoot(host);
    root = created;
    const renderWith = async (stockMachine: typeof machine): Promise<void> => {
      await act(async () =>
        created.render(
          <PlatformProvider adapter={platform}>
            <SurfacingPanel machine={stockMachine} />
          </PlatformProvider>,
        ),
      );
    };
    await renderWith(machine);
    const widthInput = (): HTMLInputElement => {
      const found = host?.querySelector('input[aria-label="Surfacing width"]');
      if (!(found instanceof HTMLInputElement)) throw new Error('Width input missing');
      return found;
    };
    expect(widthInput().value).toBe(String(machine.stock.widthMm));

    const widerStock = {
      ...machine,
      stock: { ...machine.stock, widthMm: machine.stock.widthMm + 200 },
    };
    await renderWith(widerStock);
    expect(widthInput().value).toBe(String(widerStock.stock.widthMm));
  });

  it('drops a manual area override when an equal-footprint project replaces the document', async () => {
    const { platform } = mockPlatform();
    const machine = DEFAULT_CNC_MACHINE_CONFIG;
    useStore.getState().setProject({ ...createProject(DEFAULT_DEVICE_PROFILE), machine });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(
        <PlatformProvider adapter={platform}>
          <SurfacingPanel machine={machine} />
        </PlatformProvider>,
      ),
    );
    const input = host.querySelector('input[aria-label="Surfacing width"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Width input missing');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter === undefined) throw new Error('Native input value setter missing');
    await act(async () => {
      setter.call(input, '777');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(input.value).toBe('777');

    await act(async () => {
      useStore.getState().setProject({
        ...createProject({ ...DEFAULT_DEVICE_PROFILE, profileId: 'replacement-project-device' }),
        machine: { ...machine, stock: { ...machine.stock } },
      });
    });
    expect(input.value).toBe(String(machine.stock.widthMm));
  });
});

describe('SurfacingPanel save path', () => {
  it('writes a preflighted provenance file with safe-Z before M3 and capped feeds', async () => {
    const { platform, write, pickFileForSave } = mockPlatform();
    await clickSave(platform);

    expect(pickFileForSave).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
    const data = write.mock.calls[0]?.[0];
    expect(typeof data).toBe('string');
    if (typeof data !== 'string') throw new Error('expected text output');
    expect(data).toContain(`; emitter: ${EMITTER_REVISION}`);
    expect(data.indexOf('G0 Z3.810')).toBeLessThan(data.indexOf('M3 S12000'));
    expect(data).toContain('F500.000');
    expect(data).not.toContain('F2500.000');
  });

  it('discloses requested and represented shallow depth in the file and success toast', async () => {
    const { platform, write } = mockPlatform();
    await clickSave(platform, [], 0.0006);

    const data = write.mock.calls[0]?.[0];
    expect(typeof data).toBe('string');
    if (typeof data !== 'string') throw new Error('expected text output');
    expect(data).toContain('; depth requested-total-mm: 0.0006; emitted-maximum-mm: 0.001');
    expect(data).toContain('G1 Z-0.001');
    expect(useToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({
        variant: 'success',
        message: expect.stringContaining(
          'Requested total depth 0.0006 mm; emitted maximum depth 0.001 mm',
        ),
      }),
    );
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

  it('states the no-dump controller assumption while still saving surfacing G-code', async () => {
    const originalCapabilities = useLaserStore.getState().capabilities;
    const toastCount = useToastStore.getState().toasts.length;
    try {
      await act(async () =>
        useLaserStore.setState((state) => ({
          capabilities: { ...state.capabilities, settings: 'none' },
        })),
      );
      const { platform, write } = mockPlatform();
      await clickSave(platform);

      expect(write).toHaveBeenCalledOnce();
      expect(useToastStore.getState().toasts.slice(toastCount)).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('does not report GRBL $-settings'),
          variant: 'warning',
        }),
      );
    } finally {
      await act(async () => useLaserStore.setState({ capabilities: originalCapabilities }));
    }
  });

  // Pins the exact pre/post delta without needing the old code present: for this
  // input runStandaloneCncPreflight reports ok === false, yet contributes no
  // compile-integrity issue at all. The old `if (!emitted.preflight.ok)` refusal
  // therefore fired on it; the partition does not. Revert the panel to reading
  // `.ok` raw and the two tests above go red while this one stays green —
  // together they pin why the partition is required.
  it('reports ok===false for a finding that is advisory, not compile integrity', () => {
    const preflight = runStandaloneCncPreflight(
      { ...DEFAULT_DEVICE_PROFILE, noGoZones: [ENABLED_NO_GO_ZONE] },
      DEFAULT_CNC_MACHINE_CONFIG,
      'G1 X1 Y1 F100',
    );

    expect(preflight.ok).toBe(false);
    expect(preflight.issues.some((issue) => issue.code === 'no-go-zone-collision')).toBe(true);
    expect(partitionSavePreflight(preflight.issues).blocking).toEqual([]);
  });
});
