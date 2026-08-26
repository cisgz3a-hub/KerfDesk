import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  type CncLayerSettings,
  type CncMachineConfig,
  type Layer,
} from '../../../core/scene';
import { createRectangle } from '../../../core/shapes/primitives';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { CNC_RETAINED_FEEDS_WARNING } from '../../common/cnc-bit-change-advisory';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { useToastStore } from '../../state/toast-store';
import { MachineSetupDialogHost } from './MachineSetupDialogHost';
import { openMachineSetup, useMachineSetupDialogStore } from './machine-setup-dialog-store';

vi.mock('../../cnc-viewer3d/bit-preview-three-scene', () => ({
  createBitPreviewThreeScene: vi.fn(async () => ({
    kind: 'no-webgl',
    reason: 'WebGL intentionally unavailable in Startup Setup feedback tests.',
  })),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const adapter: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

afterEach(() => {
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  resetStore();
  useMachineSetupDialogStore.setState({ state: { kind: 'idle' }, configuredRevision: 0 });
});

describe('CNC Startup Setup cutter feedback', () => {
  it('previews a staged default bit and warns only when final Save commits retained values', async () => {
    const fixture = installManualOperation();
    const view = await renderHost();
    try {
      await act(async () => openMachineSetup({ kind: 'cnc', field: 'default-bit' }));
      await changeSelect(view.host, 'Default CNC bit', fixture.alternate.id);

      expect(view.host.textContent).toContain('Modeled cutting envelope');
      expect(cncMachine().toolId).toBe(fixture.machine.toolId);
      expect(useToastStore.getState().toasts).toEqual([]);

      await saveStartup(view.host);
      expect(cncMachine().toolId).toBe(fixture.alternate.id);
      expectWarning(CNC_RETAINED_FEEDS_WARNING);
    } finally {
      await view.unmount();
    }
  });

  it('warns after final Save when Tool Plan adds a secondary bit with shared values', async () => {
    const fixture = installManualOperation({ cutType: 'v-carve', vCarveFlatDepthEnabled: true });
    const view = await renderHost();
    try {
      await act(async () => openMachineSetup({ kind: 'cnc', field: 'tool-plan' }));
      const details = view.host.querySelector('details');
      if (!(details instanceof HTMLDetailsElement)) throw new Error('Tool Plan operation missing');
      await act(async () => {
        details.open = true;
      });
      await changeSelect(
        view.host,
        `Startup floor clearing bit for ${fixture.layer.name}`,
        fixture.alternate.id,
      );

      expect(useToastStore.getState().toasts).toEqual([]);
      await saveStartup(view.host);
      expectWarning(/Secondary bit selected/);
    } finally {
      await view.unmount();
    }
  });

  it('warns after final Save when a saved profile changes the effective default bit', async () => {
    const fixture = installManualOperation();
    useStore.getState().saveCncMachineProfileFromDraft('Alternate cutter', {
      ...fixture.machine,
      toolId: fixture.alternate.id,
    });
    const profile = useStore.getState().cncLibrary.machineProfiles.at(-1);
    if (profile === undefined) throw new Error('saved profile fixture missing');
    const view = await renderHost();
    try {
      await act(async () => openMachineSetup({ kind: 'cnc', field: 'default-bit' }));
      await changeSelect(view.host, 'Saved setup profile', profile.id);
      await act(async () => buttonByAria(view.host, 'Apply saved setup profile').click());

      expect(cncMachine().toolId).toBe(fixture.machine.toolId);
      expect(useToastStore.getState().toasts).toEqual([]);
      await saveStartup(view.host);
      expect(cncMachine().toolId).toBe(fixture.alternate.id);
      expectWarning(CNC_RETAINED_FEEDS_WARNING);
    } finally {
      await view.unmount();
    }
  });

  it('warns after final Save when draft deletion falls back from a manual primary bit', async () => {
    useStore.getState().setMachineKind('cnc');
    useStore
      .getState()
      .addCustomCncTool({ name: 'Delete after review', kind: 'end-mill', diameterMm: 4 });
    const custom = useStore.getState().cncLibrary.customTools.at(-1);
    if (custom === undefined) throw new Error('custom tool fixture missing');
    installManualOperation({ toolId: custom.id }, false);
    const view = await renderHost();
    try {
      await act(async () => openMachineSetup({ kind: 'cnc', field: 'tool-plan' }));
      await act(async () => buttonByAria(view.host, `Delete bit ${custom.name}`).click());

      expect(useToastStore.getState().toasts).toEqual([]);
      expect(useStore.getState().cncLibrary.customTools).toContainEqual(custom);
      await saveStartup(view.host);
      expect(useStore.getState().cncLibrary.customTools).not.toContainEqual(custom);
      expectWarning(CNC_RETAINED_FEEDS_WARNING);
    } finally {
      await view.unmount();
    }
  });
});

function installManualOperation(
  patch: Partial<CncLayerSettings> = {},
  selectCnc = true,
): {
  readonly layer: Layer;
  readonly machine: CncMachineConfig;
  readonly alternate: CncMachineConfig['tools'][number];
} {
  if (selectCnc) useStore.getState().setMachineKind('cnc');
  const machine = cncMachine();
  const alternate = machine.tools.find(
    (tool) => tool.id !== machine.toolId && tool.kind === 'end-mill',
  );
  if (alternate === undefined) throw new Error('alternate cutter fixture missing');
  const layer = {
    ...createLayer({
      id: 'startup-feedback-operation',
      name: 'Feedback operation',
      color: '#000000',
    }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...patch },
  };
  const object = createRectangle({
    id: 'startup-feedback-shape',
    color: layer.color,
    spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
  });
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: { ...state.project.scene, objects: [object], layers: [layer] },
    },
  }));
  return { layer, machine, alternate };
}

function cncMachine(): CncMachineConfig {
  const machine = useStore.getState().project.machine;
  if (machine?.kind !== 'cnc') throw new Error('expected CNC machine');
  return machine;
}

async function saveStartup(host: HTMLElement): Promise<void> {
  await act(async () => stepButton(host, 7, 'Review & save').click());
  await act(async () => button(host, 'Save CNC startup setup').click());
}

function expectWarning(message: string | RegExp): void {
  const warnings = useToastStore.getState().toasts.filter((toast) => toast.variant === 'warning');
  if (typeof message === 'string') {
    expect(warnings).toContainEqual(expect.objectContaining({ message }));
  } else {
    expect(warnings.some((toast) => message.test(toast.message))).toBe(true);
  }
}

async function renderHost(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={adapter}>
        <MachineSetupDialogHost />
      </PlatformProvider>,
    );
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

async function changeSelect(host: HTMLElement, ariaLabel: string, value: string): Promise<void> {
  const field = select(host, ariaLabel);
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
}

function select(host: HTMLElement, ariaLabel: string): HTMLSelectElement {
  const match = host.querySelector(`select[aria-label="${ariaLabel}"]`);
  if (!(match instanceof HTMLSelectElement)) throw new Error(`select missing: ${ariaLabel}`);
  return match;
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button missing: ${label}`);
  return match;
}

function buttonByAria(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button missing: ${label}`);
  return match;
}

function stepButton(host: HTMLElement, step: number, label: string): HTMLButtonElement {
  const match = host.querySelector(`button[aria-label="Go to step ${step}: ${label}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`step missing: ${label}`);
  return match;
}
