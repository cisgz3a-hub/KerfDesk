import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  type CncLayerSettings,
  type CncMachineConfig,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { CncActiveBitSelect } from './CncActiveBitSelect';

vi.mock('../cnc-viewer3d/bit-preview-three-scene', () => ({
  createBitPreviewThreeScene: vi.fn(async () => ({
    kind: 'no-webgl',
    reason: 'WebGL intentionally unavailable in this selector test.',
  })),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  resetStore();
});

function installCnc(
  settings: CncLayerSettings,
  options: { readonly output?: boolean; readonly used?: boolean } = {},
): CncMachineConfig {
  const base = createProject();
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: settings,
    output: options.output ?? true,
  };
  const object = createRectangle({
    id: 'R1',
    color: layer.color,
    spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
  });
  useStore.setState({
    project: {
      ...base,
      scene: { objects: options.used === false ? [] : [object], layers: [layer] },
    },
  });
  useStore.getState().setMachineKind('cnc');
  const machine = useStore.getState().project.machine;
  if (machine?.kind !== 'cnc') throw new Error('CNC machine missing');
  return machine;
}

function addOneFluteTool(): { readonly machine: CncMachineConfig; readonly toolId: string } {
  useStore.getState().addCustomCncTool({
    name: 'One-flute Active bit',
    kind: 'end-mill',
    diameterMm: 6.35,
    fluteCount: 1,
  });
  const toolId = useStore.getState().cncLibrary.customTools[0]?.id;
  if (toolId === undefined) throw new Error('custom bit missing');
  const machine = useStore.getState().project.machine;
  if (machine?.kind !== 'cnc') throw new Error('CNC machine missing');
  return { machine, toolId };
}

async function render(machine: CncMachineConfig): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<CncActiveBitSelect machine={machine} />));
  return { host, root };
}

function settings(): CncLayerSettings | undefined {
  return useStore.getState().project.scene.layers[0]?.cnc;
}

function selectBit(host: HTMLElement, value: string): void {
  const select = host.querySelector('select[aria-label="Active bit"]');
  if (!(select instanceof HTMLSelectElement)) throw new Error('Active bit select missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('CncActiveBitSelect retained-feed advisory', () => {
  it('shows stored V-bit geometry before a potentially misleading custom name', async () => {
    const machine = installCnc(DEFAULT_CNC_LAYER_SETTINGS);
    const customMachine: CncMachineConfig = {
      ...machine,
      tools: [
        ...machine.tools,
        {
          id: 'custom-misnamed-vbit',
          name: '90 degree 3 mm',
          kind: 'v-bit',
          diameterMm: 3.175,
          tipAngleDeg: 90,
        },
      ],
    };
    const { host, root } = await render(customMachine);
    try {
      const option = host.querySelector(
        'option[value="custom-misnamed-vbit"]',
      ) as HTMLOptionElement | null;
      expect(option?.textContent).toBe('3.175 mm, 90° V-bit — 90 degree 3 mm');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('warns when an Active bit change retains manual numeric settings', async () => {
    const manual = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      feedMmPerMin: 777,
      plungeMmPerMin: 123,
      spindleRpm: 10_000,
      depthPerPassMm: 0.4,
    };
    const machine = installCnc(manual);
    const { host, root } = await render(machine);
    try {
      await act(async () => selectBit(host, 'em-6350'));
      expect(settings()).toMatchObject({
        feedMmPerMin: 777,
        plungeMmPerMin: 123,
        spindleRpm: 10_000,
        depthPerPassMm: 0.4,
      });
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        variant: 'warning',
        message: expect.stringMatching(/kept.*verify/i),
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('warns when a missing explicit primary id falls back to Active with manual values', async () => {
    const manual = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      toolId: 'deleted-primary',
      feedMmPerMin: 777,
      plungeMmPerMin: 123,
      spindleRpm: 10_000,
      depthPerPassMm: 0.4,
    };
    const machine = installCnc(manual);
    const { host, root } = await render(machine);
    try {
      await act(async () => selectBit(host, 'em-6350'));
      expect(settings()).toMatchObject({
        toolId: 'deleted-primary',
        feedMmPerMin: 777,
        plungeMmPerMin: 123,
        spindleRpm: 10_000,
        depthPerPassMm: 0.4,
      });
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        variant: 'warning',
        message: expect.stringMatching(/kept.*verify/i),
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('warns when an Active bit change preserves a no-longer-matching starter', async () => {
    const starter = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      feedMmPerMin: 300,
      plungeMmPerMin: 250,
      spindleRpm: 12_000,
      depthPerPassMm: 0.75,
      feedSource: {
        kind: 'machine-starter' as const,
        starterId: 'neotronics-4040-safe',
        revision: 2,
      },
    };
    const machine = installCnc(starter);
    const { host, root } = await render(machine);
    try {
      await act(async () => selectBit(host, 'em-6350'));
      expect(settings()).toMatchObject({
        feedMmPerMin: 300,
        plungeMmPerMin: 250,
        spindleRpm: 12_000,
        depthPerPassMm: 0.75,
      });
      expect(settings()?.feedSource).toBeUndefined();
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ variant: 'warning' });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('does not warn when a material recipe successfully recalculates for the new bit', async () => {
    const recipe = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      materialKey: 'plywood-mdf',
      feedMmPerMin: 111,
      feedSource: {
        kind: 'material-recipe' as const,
        materialKey: 'plywood-mdf',
        fluteCount: 2,
      },
    };
    const machine = installCnc(recipe);
    const { host, root } = await render(machine);
    try {
      await act(async () => selectBit(host, 'em-6350'));
      expect(settings()?.feedMmPerMin).not.toBe(111);
      expect(settings()?.feedSource).toEqual(recipe.feedSource);
      expect(useToastStore.getState().toasts).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('recalculates a recipe whose missing primary id falls back to Active without warning', async () => {
    const recipe = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      toolId: 'deleted-primary',
      materialKey: 'plywood-mdf',
      feedMmPerMin: 111,
      feedSource: {
        kind: 'material-recipe' as const,
        materialKey: 'plywood-mdf',
        fluteCount: 2,
      },
    };
    installCnc(recipe);
    const { machine, toolId } = addOneFluteTool();
    const before = settings();
    expect(before?.feedSource).toEqual(recipe.feedSource);
    const { host, root } = await render(machine);
    try {
      await act(async () => selectBit(host, toolId));
      expect(settings()?.toolId).toBe('deleted-primary');
      expect([
        settings()?.feedMmPerMin,
        settings()?.plungeMmPerMin,
        settings()?.depthPerPassMm,
      ]).not.toEqual([before?.feedMmPerMin, before?.plungeMmPerMin, before?.depthPerPassMm]);
      expect(settings()?.feedSource).toEqual({
        kind: 'material-recipe',
        materialKey: 'plywood-mdf',
        fluteCount: 1,
      });
      expect(useToastStore.getState().toasts).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('does nothing and emits no warning when the Active bit is unchanged', async () => {
    const machine = installCnc(DEFAULT_CNC_LAYER_SETTINGS);
    const { host, root } = await render(machine);
    try {
      const dirtyBefore = useStore.getState().dirty;
      await act(async () => selectBit(host, machine.toolId));
      expect(useStore.getState().project.machine).toBe(machine);
      expect(useStore.getState().dirty).toBe(dirtyBefore);
      expect(useToastStore.getState().toasts).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it.each([
    ['output-off', { output: false }],
    ['unused', { used: false }],
  ] as const)('does not warn for a retained-values %s operation', async (_case, options) => {
    const machine = installCnc(DEFAULT_CNC_LAYER_SETTINGS, options);
    const { host, root } = await render(machine);
    try {
      await act(async () => selectBit(host, 'em-6350'));
      expect(useToastStore.getState().toasts).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('withdraws failed recipe provenance and warns when the values are retained', async () => {
    const unresolvedRecipe = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      materialKey: 'unknown-material',
      feedMmPerMin: 111,
      feedSource: {
        kind: 'material-recipe' as const,
        materialKey: 'unknown-material',
        fluteCount: 2,
      },
    };
    const machine = installCnc(unresolvedRecipe);
    const { host, root } = await render(machine);
    try {
      await act(async () => selectBit(host, 'em-6350'));
      expect(settings()?.feedMmPerMin).toBe(111);
      expect(settings()?.feedSource).toBeUndefined();
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ variant: 'warning' });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
