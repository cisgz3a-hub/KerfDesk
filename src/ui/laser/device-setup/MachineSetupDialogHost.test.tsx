import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHIPLOAD_MATERIALS } from '../../../core/cnc';
import { createLayer, DEFAULT_CNC_LAYER_SETTINGS } from '../../../core/scene';
import { MODELED_CNC_BIT_CATALOG } from '../../machine/cnc-bit-catalog';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useStore } from '../../state';
import { resetStore, svgObj } from '../../state/test-helpers';
import { MachineSetupDialogHost } from './MachineSetupDialogHost';
import { openMachineSetup, useMachineSetupDialogStore } from './machine-setup-dialog-store';

vi.mock('../../cnc-viewer3d/bit-preview-three-scene', () => ({
  createBitPreviewThreeScene: vi.fn(async () => ({
    kind: 'no-webgl',
    reason: 'WebGL intentionally unavailable in Machine Setup host tests.',
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
  resetStore();
  useMachineSetupDialogStore.setState({ state: { kind: 'idle' }, configuredRevision: 0 });
});

describe('MachineSetupDialogHost', () => {
  it('does not open Startup Setup when CNC artwork is placed', async () => {
    useStore.getState().setMachineKind('cnc');
    const view = await renderHost();
    try {
      expect(useMachineSetupDialogStore.getState().state.kind).toBe('idle');
      await act(async () =>
        useStore.getState().importSvgObject(svgObj('placed-artwork', ['#000000'])),
      );
      expect(useMachineSetupDialogStore.getState().state.kind).toBe('idle');
      expect(view.host.textContent).not.toContain('CNC Startup Setup');
    } finally {
      await view.unmount();
    }
  });

  it('opens a CNC field globally, focuses it, and discards draft edits on Cancel', async () => {
    useStore.getState().setMachineKind('cnc');
    const before = cncMachine().params.spindleMaxRpm;
    const view = await renderHost();
    try {
      await act(async () => openMachineSetup({ kind: 'cnc', field: 'spindle-max' }));
      expect(view.host.textContent).toContain('CNC Startup Setup');
      expect(view.host.textContent).toContain('Step 5 of 7 — CNC Startup Setup');
      expect(document.activeElement?.getAttribute('aria-label')).toBe(
        'Spindle maximum in Startup Setup',
      );
      await changeInput(view.host, 'Spindle maximum', '18000');
      expect(cncMachine().params.spindleMaxRpm).toBe(before);
      await act(async () => button(view.host, 'Cancel without saving').click());
      expect(cncMachine().params.spindleMaxRpm).toBe(before);
      expect(view.host.textContent).not.toContain('Step 5 of 7');
    } finally {
      await view.unmount();
    }
  });

  it('shows one staged job setup and snapshots the draft, not the live project, to a profile', async () => {
    useStore.getState().setMachineKind('cnc');
    const before = cncMachine().params.spindleMaxRpm;
    const view = await renderHost();
    try {
      await act(async () => openMachineSetup({ kind: 'cnc', field: 'material' }));
      expect(select(view.host, 'Project material')).toBeInstanceOf(HTMLSelectElement);
      expect(select(view.host, 'Default CNC bit')).toBeInstanceOf(HTMLSelectElement);
      expect(input(view.host, 'Stock thickness')).toBeInstanceOf(HTMLInputElement);
      expect(select(view.host, 'Saved setup profile')).toBeInstanceOf(HTMLSelectElement);
      await changeInput(view.host, 'Spindle maximum', '18000');
      await changeText(view.host, 'New setup profile name', 'Oak startup');
      await act(async () => button(view.host, 'Save current draft').click());
      const profile = useStore.getState().cncLibrary.machineProfiles.at(-1);
      expect(profile?.name).toBe('Oak startup');
      expect(profile?.machine.params.spindleMaxRpm).toBe(18000);
      expect(cncMachine().params.spindleMaxRpm).toBe(before);
    } finally {
      await view.unmount();
    }
  });

  it('commits material, default bit, and operation Tool Plan together on final Save', async () => {
    useStore.getState().setMachineKind('cnc');
    const initial = useStore.getState();
    const operation = {
      ...createLayer({ id: 'setup-operation', name: 'Pocket', color: '#000000' }),
      cnc: DEFAULT_CNC_LAYER_SETTINGS,
    };
    useStore.setState({
      project: {
        ...initial.project,
        scene: { ...initial.project.scene, layers: [operation] },
      },
    });
    const beforeUndo = useStore.getState().undoStack.length;
    const layer = useStore.getState().project.scene.layers[0];
    if (layer === undefined) throw new Error('expected operation');
    const machine = cncMachine();
    const nextTool = machine.tools.find((tool) => tool.id !== machine.toolId);
    const material = CHIPLOAD_MATERIALS[0];
    if (nextTool === undefined || material === undefined) throw new Error('fixture missing');
    const view = await renderHost();
    try {
      await act(async () => openMachineSetup({ kind: 'cnc', field: 'material' }));
      await changeSelect(view.host, 'Project material', material.value);
      await act(async () => button(view.host, `Apply ${material.label}`).click());
      await changeSelect(view.host, 'Default CNC bit', nextTool.id);
      const details = view.host.querySelector('details');
      if (!(details instanceof HTMLDetailsElement)) throw new Error('Tool Plan operation missing');
      await act(async () => {
        details.open = true;
      });
      await changeSelect(view.host, `Startup bit for ${layer.name}`, nextTool.id);
      expect(cncMachine().stock.materialKey).toBeUndefined();
      await act(async () => stepButton(view.host, 7, 'Review & save').click());
      await act(async () => button(view.host, 'Save CNC startup setup').click());
      const after = cncMachine();
      expect(after.stock.materialKey).toBe(material.value);
      expect(after.toolId).toBe(nextTool.id);
      expect(useStore.getState().project.scene.layers[0]?.cnc?.materialKey).toBe(material.value);
      expect(useStore.getState().project.scene.layers[0]?.cnc?.toolId).toBe(nextTool.id);
      expect(useStore.getState().undoStack).toHaveLength(beforeUndo + 1);
    } finally {
      await view.unmount();
    }
  });

  it('owns bit-library editing without mutating the live project when Startup Setup is cancelled', async () => {
    useStore.getState().setMachineKind('cnc');
    const beforeProject = JSON.stringify(useStore.getState().project);
    const beforeCustomTools = useStore.getState().cncLibrary.customTools;
    const beforeUndo = useStore.getState().undoStack.length;
    const beforeDirty = useStore.getState().dirty;
    const view = await renderHost();
    try {
      await act(async () => openMachineSetup({ kind: 'cnc', field: 'default-bit' }));
      expect(view.host.textContent).toContain('Bit library');
      await changeText(view.host, 'New bit name', 'Startup-only bit');
      await changeInput(view.host, 'New bit diameter (mm)', '4');
      await act(async () => buttonByAria(view.host, 'Add bit').click());
      const added = [...select(view.host, 'Default CNC bit').options].find((option) =>
        option.textContent?.includes('Startup-only bit'),
      );
      if (added === undefined) throw new Error('custom bit was not staged');
      expect(cncMachine().tools.some((tool) => tool.id === added.value)).toBe(false);
      expect(useStore.getState().cncLibrary.customTools).toBe(beforeCustomTools);
      await act(async () => button(view.host, 'Cancel without saving').click());
      expect(JSON.stringify(useStore.getState().project)).toBe(beforeProject);
      expect(useStore.getState().undoStack).toHaveLength(beforeUndo);
      expect(useStore.getState().dirty).toBe(beforeDirty);

      await act(async () => openMachineSetup({ kind: 'cnc', field: 'default-bit' }));
      expect(
        [...select(view.host, 'Default CNC bit').options].some(
          (option) => option.value === added.value,
        ),
      ).toBe(false);
    } finally {
      await view.unmount();
    }
  });

  it('stages custom-bit deletion and clears its Tool Plan assignment on final Save', async () => {
    useStore.getState().setMachineKind('cnc');
    useStore
      .getState()
      .addCustomCncTool({ name: 'Delete in Startup', kind: 'end-mill', diameterMm: 4 });
    const custom = useStore.getState().cncLibrary.customTools.at(-1);
    if (custom === undefined) throw new Error('custom bit fixture missing');
    const operation = {
      ...createLayer({ id: 'delete-tool-operation', name: 'Delete tool', color: '#000000' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, toolId: custom.id },
    };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: { ...state.project.scene, layers: [operation] },
      },
    }));
    const view = await renderHost();
    try {
      await act(async () => openMachineSetup({ kind: 'cnc', field: 'tool-plan' }));
      await act(async () => buttonByAria(view.host, 'Delete bit Delete in Startup').click());
      expect(useStore.getState().cncLibrary.customTools).toContainEqual(custom);
      expect(cncMachine().tools.some((tool) => tool.id === custom.id)).toBe(true);
      expect(useStore.getState().project.scene.layers[0]?.cnc?.toolId).toBe(custom.id);
      await act(async () => stepButton(view.host, 7, 'Review & save').click());
      await act(async () => button(view.host, 'Save CNC startup setup').click());
      expect(cncMachine().tools.some((tool) => tool.id === custom.id)).toBe(false);
      expect(useStore.getState().cncLibrary.customTools).not.toContainEqual(custom);
      expect(useStore.getState().project.scene.layers[0]?.cnc?.toolId).toBeUndefined();
    } finally {
      await view.unmount();
    }
  });

  it('stages existing and catalog-bit flute counts until final CNC Startup Save', async () => {
    useStore.getState().setMachineKind('cnc');
    const existing = cncMachine().tools.find((tool) => tool.id === 'em-3175');
    const catalog = MODELED_CNC_BIT_CATALOG.find(
      (entry) => !cncMachine().tools.some((tool) => tool.catalogId === entry.id),
    );
    if (existing === undefined || catalog === undefined) throw new Error('bit fixture missing');
    const view = await renderHost();
    try {
      await act(async () => openMachineSetup({ kind: 'cnc', field: 'tool-plan' }));
      await changeInput(view.host, `Flute count for ${existing.name}`, '3');
      await act(async () =>
        buttonByAria(view.host, `Add ${catalog.tool.name} from catalog`).click(),
      );
      await changeInput(view.host, `Flute count for ${catalog.tool.name}`, '4');

      expect(
        cncMachine().tools.find((tool) => tool.id === existing.id)?.fluteCount,
      ).toBeUndefined();
      expect(
        useStore.getState().cncLibrary.customTools.some((tool) => tool.catalogId === catalog.id),
      ).toBe(false);
      await act(async () => button(view.host, 'Cancel without saving').click());
      expect(
        cncMachine().tools.find((tool) => tool.id === existing.id)?.fluteCount,
      ).toBeUndefined();

      await act(async () => openMachineSetup({ kind: 'cnc', field: 'tool-plan' }));
      await changeInput(view.host, `Flute count for ${existing.name}`, '3');
      await act(async () =>
        buttonByAria(view.host, `Add ${catalog.tool.name} from catalog`).click(),
      );
      await changeInput(view.host, `Flute count for ${catalog.tool.name}`, '4');
      await act(async () => stepButton(view.host, 7, 'Review & save').click());
      await act(async () => button(view.host, 'Save CNC startup setup').click());

      expect(cncMachine().tools.find((tool) => tool.id === existing.id)?.fluteCount).toBe(3);
      expect(useStore.getState().cncLibrary.customTools).toContainEqual(
        expect.objectContaining({ catalogId: catalog.id, fluteCount: 4 }),
      );
      expect(cncMachine().tools).toContainEqual(
        expect.objectContaining({ catalogId: catalog.id, fluteCount: 4 }),
      );
    } finally {
      await view.unmount();
    }
  });
});

function cncMachine() {
  const machine = useStore.getState().project.machine;
  if (machine?.kind !== 'cnc') throw new Error('expected CNC machine');
  return machine;
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

async function changeInput(host: HTMLElement, ariaLabel: string, value: string): Promise<void> {
  const field = input(host, ariaLabel);
  await act(async () => {
    field.value = value;
    Simulate.change(field);
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

async function changeText(host: HTMLElement, ariaLabel: string, value: string): Promise<void> {
  const field = input(host, ariaLabel);
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
}

async function changeSelect(host: HTMLElement, ariaLabel: string, value: string): Promise<void> {
  const field = select(host, ariaLabel);
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
}

function input(host: HTMLElement, ariaLabel: string): HTMLInputElement {
  const match = [...host.querySelectorAll('input')].find(
    (candidate) => candidate.getAttribute('aria-label') === ariaLabel,
  );
  if (!(match instanceof HTMLInputElement)) throw new Error(`input missing: ${ariaLabel}`);
  return match;
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
