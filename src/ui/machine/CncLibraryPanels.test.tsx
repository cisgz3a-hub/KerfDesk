import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type ReliefObject,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { CncMachineProfilesRow, CncToolManager } from './CncLibraryPanels';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  resetStore();
  useStore.setState({ cncLibrary: { customTools: [], feedPresets: [], machineProfiles: [] } });
});

afterEach(() => {
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
});

function installUsedLayer(settings: CncLayerSettings, output = true, relief = false): void {
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: settings,
    output,
  };
  const object: ReliefObject | ReturnType<typeof createRectangle> = relief
    ? {
        kind: 'relief',
        id: 'R1',
        source: 'model.stl',
        meshPositions: [0, 0, 0, 10, 0, 0, 0, 5, 5],
        targetWidthMm: 10,
        reliefDepthMm: 2,
        emptyCells: 'floor',
        color: layer.color,
        bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
        transform: IDENTITY_TRANSFORM,
      }
    : createRectangle({
        id: 'R1',
        color: layer.color,
        spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
      });
  useStore.setState((state) => ({
    project: { ...state.project, scene: { objects: [object], layers: [layer] } },
  }));
}

const SECONDARY_REFERENCE_CASES = [
  {
    field: 'vClearToolId',
    role: 'V-carve clearing',
    activePatch: { cutType: 'v-carve' },
    dormantPatch: { cutType: 'engrave' },
    relief: false,
  },
  {
    field: 'reliefFinishToolId',
    role: 'relief finishing',
    activePatch: {},
    dormantPatch: {},
    relief: true,
  },
  {
    field: 'pocketRoughToolId',
    role: 'pocket roughing',
    activePatch: { cutType: 'pocket', pocketStrategy: 'offset' },
    dormantPatch: { cutType: 'pocket', pocketStrategy: 'adaptive' },
    relief: false,
  },
] as const;

async function render(component: React.ReactNode): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(component));
  return { host, root };
}

async function applySameIdSingleFluteProfile(settings: CncLayerSettings): Promise<void> {
  useStore.setState({ project: createProject() });
  useStore.getState().setMachineKind('cnc');
  const current = useStore.getState().project.machine;
  if (current?.kind !== 'cnc') throw new Error('CNC machine missing');
  const profileMachine = {
    ...current,
    tools: current.tools.map((tool) =>
      tool.id === current.toolId ? { ...tool, fluteCount: 1 } : tool,
    ),
  };
  useStore.setState((state) => ({
    cncLibrary: {
      ...state.cncLibrary,
      machineProfiles: [{ id: 'single-flute', name: 'Single flute', machine: profileMachine }],
    },
  }));
  installUsedLayer(settings);

  const { host, root } = await render(<CncMachineProfilesRow />);
  try {
    const select = host.querySelector('[aria-label="Saved machine profile"]');
    if (!(select instanceof HTMLSelectElement)) throw new Error('Profile select missing');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(select, 'single-flute');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const apply = host.querySelector('[aria-label="Apply machine profile"]');
    if (!(apply instanceof HTMLButtonElement)) throw new Error('Apply button missing');
    await act(async () => apply.click());
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}

describe('CncToolManager', () => {
  it('shows canonical stored geometry even when the custom name contains another size', async () => {
    useStore.setState({ project: createProject() });
    useStore.getState().setMachineKind('cnc');
    useStore.getState().addCustomCncTool({
      name: '90 degree 3mm V-bit',
      kind: 'v-bit',
      diameterMm: 3.175,
      tipAngleDeg: 90,
    });
    const machine = useStore.getState().project.machine;
    if (machine?.kind !== 'cnc') throw new Error('CNC machine missing');

    const { host, root } = await render(<CncToolManager machine={machine} />);
    try {
      const customRow = host
        .querySelector('[aria-label="Delete bit 90 degree 3mm V-bit"]')
        ?.closest('li');
      expect(customRow).toBeDefined();
      expect(customRow?.textContent).toContain('3.175 mm');
      expect(customRow?.textContent).toContain('90° V-bit');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('puts canonical geometry before an incident-style long name and keeps the full label visible', async () => {
    useStore.setState({ project: createProject() });
    useStore.getState().setMachineKind('cnc');
    const longName =
      'My exceptionally long custom cutter name that would previously hide the actual geometry';
    useStore
      .getState()
      .addCustomCncTool({ name: longName, kind: 'v-bit', diameterMm: 3.175, tipAngleDeg: 90 });
    const machine = useStore.getState().project.machine;
    if (machine?.kind !== 'cnc') throw new Error('CNC machine missing');

    const { host, root } = await render(<CncToolManager machine={machine} />);
    try {
      const row = host.querySelector(`[aria-label="Delete bit ${longName}"]`)?.closest('li');
      const label = row?.querySelector('span');
      expect(label?.textContent).toBe(`3.175 mm, 90° V-bit — ${longName}`);
      expect(label?.getAttribute('title')).toBe(label?.textContent);
      expect(label?.getAttribute('aria-label')).toBe(label?.textContent);
      expect((label as HTMLElement).style.whiteSpace).toBe('normal');
      expect((label as HTMLElement).style.overflowWrap).toBe('anywhere');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it.each(['active', 'layer override'] as const)(
    'warns when deleting a custom bit changes the effective %s cutter but retains manual values',
    async (scenario) => {
      useStore.setState({ project: createProject() });
      useStore.getState().setMachineKind('cnc');
      useStore
        .getState()
        .addCustomCncTool({ name: 'Wide custom', kind: 'end-mill', diameterMm: 6.35 });
      const customId = useStore.getState().cncLibrary.customTools[0]?.id;
      if (customId === undefined) throw new Error('Custom tool missing');
      if (scenario === 'active') useStore.getState().updateCncMachine({ toolId: customId });
      installUsedLayer({
        ...DEFAULT_CNC_LAYER_SETTINGS,
        ...(scenario === 'layer override' ? { toolId: customId } : {}),
        feedMmPerMin: 777,
      });
      const machine = useStore.getState().project.machine;
      if (machine?.kind !== 'cnc') throw new Error('CNC machine missing');

      const { host, root } = await render(<CncToolManager machine={machine} />);
      try {
        const button = host.querySelector('[aria-label="Delete bit Wide custom"]');
        if (!(button instanceof HTMLButtonElement)) throw new Error('Delete button missing');
        await act(async () => button.click());
        expect(
          useStore.getState().cncLibrary.customTools.some((tool) => tool.id === customId),
        ).toBe(false);
        expect(useStore.getState().project.scene.layers[0]?.cnc?.feedMmPerMin).toBe(777);
        expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
          variant: 'warning',
          message: expect.stringMatching(/feed.*kept.*verify/i),
        });
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );

  it.each(SECONDARY_REFERENCE_CASES)(
    'blocks deletion while $role actively uses the custom bit',
    async ({ field, role, activePatch, relief }) => {
      useStore.setState({ project: createProject() });
      useStore.getState().setMachineKind('cnc');
      useStore
        .getState()
        .addCustomCncTool({ name: 'Staged custom', kind: 'end-mill', diameterMm: 6.35 });
      const customId = useStore.getState().cncLibrary.customTools[0]?.id;
      if (customId === undefined) throw new Error('Custom tool missing');
      installUsedLayer(
        { ...DEFAULT_CNC_LAYER_SETTINGS, ...activePatch, [field]: customId },
        true,
        relief,
      );
      const machine = useStore.getState().project.machine;
      if (machine?.kind !== 'cnc') throw new Error('CNC machine missing');

      const { host, root } = await render(<CncToolManager machine={machine} />);
      try {
        const button = host.querySelector('[aria-label="Delete bit Staged custom"]');
        if (!(button instanceof HTMLButtonElement)) throw new Error('Delete button missing');
        expect(button.title).toMatch(/Primary assignments fall back.*visible/i);
        await act(async () => button.click());

        expect(
          useStore.getState().cncLibrary.customTools.some((tool) => tool.id === customId),
        ).toBe(true);
        const afterMachine = useStore.getState().project.machine;
        if (afterMachine?.kind !== 'cnc') throw new Error('CNC machine missing');
        expect(afterMachine.tools.some((tool) => tool.id === customId)).toBe(true);
        const warning = useToastStore.getState().toasts.at(-1);
        expect(warning).toMatchObject({ variant: 'warning' });
        expect(warning?.message).toContain(role);
        expect(warning?.message).toContain('#ff0000');
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );

  it.each(SECONDARY_REFERENCE_CASES)(
    'deletes the bit and clears dormant $field state',
    async ({ field, dormantPatch, relief }) => {
      useStore.setState({ project: createProject() });
      useStore.getState().setMachineKind('cnc');
      useStore
        .getState()
        .addCustomCncTool({ name: 'Dormant custom', kind: 'end-mill', diameterMm: 6.35 });
      const customId = useStore.getState().cncLibrary.customTools[0]?.id;
      if (customId === undefined) throw new Error('Custom tool missing');
      installUsedLayer(
        { ...DEFAULT_CNC_LAYER_SETTINGS, ...dormantPatch, [field]: customId },
        true,
        field === 'reliefFinishToolId' ? false : relief,
      );
      const machine = useStore.getState().project.machine;
      if (machine?.kind !== 'cnc') throw new Error('CNC machine missing');

      const { host, root } = await render(<CncToolManager machine={machine} />);
      try {
        const button = host.querySelector('[aria-label="Delete bit Dormant custom"]');
        if (!(button instanceof HTMLButtonElement)) throw new Error('Delete button missing');
        await act(async () => button.click());

        expect(
          useStore.getState().cncLibrary.customTools.some((tool) => tool.id === customId),
        ).toBe(false);
        expect(useStore.getState().project.scene.layers[0]?.cnc?.[field]).toBeUndefined();
        expect(useToastStore.getState().toasts).toEqual([]);
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );
});

describe('CncMachineProfilesRow', () => {
  it('warns when Apply changes the effective cutter while retaining manual values', async () => {
    useStore.setState({ project: createProject() });
    useStore.getState().setMachineKind('cnc');
    useStore.getState().updateCncMachine({ toolId: 'em-6350' });
    useStore.getState().saveCncMachineProfile('Wide bit setup');
    useStore.getState().updateCncMachine({ toolId: 'em-3175' });
    installUsedLayer({ ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 777 });
    const profileId = useStore.getState().cncLibrary.machineProfiles[0]?.id;
    if (profileId === undefined) throw new Error('Machine profile missing');

    const { host, root } = await render(<CncMachineProfilesRow />);
    try {
      const select = host.querySelector('[aria-label="Saved machine profile"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('Profile select missing');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      await act(async () => {
        setter?.call(select, profileId);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const apply = host.querySelector('[aria-label="Apply machine profile"]');
      if (!(apply instanceof HTMLButtonElement)) throw new Error('Apply button missing');
      await act(async () => apply.click());

      const machine = useStore.getState().project.machine;
      expect(machine?.kind === 'cnc' ? machine.toolId : null).toBe('em-6350');
      expect(useStore.getState().project.scene.layers[0]?.cnc?.feedMmPerMin).toBe(777);
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ variant: 'warning' });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('warns when a same-ID flute-count profile change retains manual values', async () => {
    await applySameIdSingleFluteProfile({
      ...DEFAULT_CNC_LAYER_SETTINGS,
      feedMmPerMin: 777,
    });

    const machine = useStore.getState().project.machine;
    if (machine?.kind !== 'cnc') throw new Error('CNC machine missing');
    expect(machine.tools.find((tool) => tool.id === machine.toolId)?.fluteCount).toBe(1);
    expect(useStore.getState().project.scene.layers[0]?.cnc?.feedMmPerMin).toBe(777);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ variant: 'warning' });
  });

  it('stays silent when a same-ID flute-count profile change recalculates automatic values', async () => {
    await applySameIdSingleFluteProfile({
      ...DEFAULT_CNC_LAYER_SETTINGS,
      materialKey: 'plywood-mdf',
      feedMmPerMin: 777,
      feedSource: {
        kind: 'material-recipe',
        materialKey: 'plywood-mdf',
        fluteCount: 2,
      },
    });

    const machine = useStore.getState().project.machine;
    if (machine?.kind !== 'cnc') throw new Error('CNC machine missing');
    expect(machine.tools.find((tool) => tool.id === machine.toolId)?.fluteCount).toBe(1);
    expect(useStore.getState().project.scene.layers[0]?.cnc?.feedSource).toEqual({
      kind: 'material-recipe',
      materialKey: 'plywood-mdf',
      fluteCount: 1,
    });
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
