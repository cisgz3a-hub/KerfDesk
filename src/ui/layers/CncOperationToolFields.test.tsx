import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateFeeds } from '../../core/cnc';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  layerCncTool,
  type CncLayerSettings,
  type Layer,
} from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from '../state';
import { cncStartupOperationDraft } from '../state/cnc-startup-setup';
import { resetStore, svgObj } from '../state/test-helpers';
import { CncLayerFields } from './CncLayerFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

function ConnectedFields(): JSX.Element {
  const layer = useStore((state) =>
    state.project.scene.layers.find((entry) => entry.id === 'chosen'),
  );
  if (layer === undefined) throw new Error('Operation missing');
  return <CncLayerFields layer={layer} />;
}

async function renderFields(patch: Partial<CncLayerSettings> = {}): Promise<void> {
  resetStore();
  const chosen: Layer = {
    ...createLayer({ id: 'chosen', color: '#123456' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'pocket',
      toolId: 'em-3175',
      feedMmPerMin: 731,
      plungeMmPerMin: 219,
      depthPerPassMm: 0.7,
      vClearToolId: 'em-6350',
      pocketRoughToolId: 'em-6350',
      reliefFinishToolId: 'bn-3175',
      ...patch,
    },
  };
  const peer = {
    ...createLayer({ id: 'peer', color: '#abcdef' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 643 },
  };
  useStore.setState({
    project: {
      ...createProject(),
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, materialKey: 'hardwood' },
      },
      scene: {
        layers: [chosen, peer],
        objects: [
          { ...svgObj('chosen-art', [chosen.color]), operationIds: [chosen.id] },
          { ...svgObj('peer-art', [peer.color]), operationIds: [peer.id] },
        ],
      },
    },
    selectedObjectId: 'chosen-art',
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<ConnectedFields />));
}

function selectedSettings(): CncLayerSettings {
  const settings = useStore.getState().project.scene.layers[0]?.cnc;
  if (settings === undefined) throw new Error('CNC settings missing');
  return settings;
}

function field(label: string): HTMLSelectElement {
  const element = host.querySelector<HTMLSelectElement>(
    `select[aria-label="${label} for #123456"]`,
  );
  if (element === null) throw new Error(`Missing ${label}`);
  return element;
}

async function choose(label: string, value: string): Promise<void> {
  await act(async () => {
    const element = field(label);
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function feedInput(): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Feed for #123456"]');
  if (input === null) throw new Error('Feed missing');
  return input;
}

async function draftFeed(value: string): Promise<void> {
  await act(async () => {
    const input = feedInput();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  resetStore();
  vi.useRealTimers();
});

describe('direct CNC operation assignments', () => {
  it('changes only the primary operation bit and can return to the unchanged job default', async () => {
    await renderFields();
    const before = useStore.getState().project;
    const original = selectedSettings();
    await choose('Bit', 'em-1588');
    expect(selectedSettings()).toEqual({ ...original, toolId: 'em-1588' });
    expect(useStore.getState().project.machine).toBe(before.machine);
    expect(useStore.getState().project.scene.layers[1]).toBe(before.scene.layers[1]);
    expect(useStore.getState().project.scene.objects).toBe(before.scene.objects);
    expect(useStore.getState().undoStack).toEqual([before]);
    await choose('Bit', '');
    const { toolId: _toolId, ...withoutOverride } = original;
    expect(selectedSettings()).toEqual(withoutOverride);
    expect(useStore.getState().project.machine).toBe(before.machine);
    expect(field('Bit').value).toBe('');
  });

  it('applies material starting feeds to this operation and leaves future-operation defaults intact', async () => {
    await renderFields();
    const before = useStore.getState();
    const original = selectedSettings();
    const expected = calculateFeeds({
      material: 'acrylic',
      bitDiameterMm: 3.175,
      flutes: 2,
      rpm: 12000,
      maxFeedMmPerMin: before.project.device.maxFeed,
    });
    if (expected.kind === 'error') throw new Error(expected.reason);
    await choose('Material', 'acrylic');
    expect(selectedSettings()).toMatchObject({
      materialKey: 'acrylic',
      feedMmPerMin: expected.feedMmPerMin,
      plungeMmPerMin: expected.plungeMmPerMin,
      depthPerPassMm: expected.depthPerPassMm,
      feedSource: { kind: 'material-recipe', materialKey: 'acrylic', fluteCount: 2 },
      depthMm: original.depthMm,
      stepoverPercent: original.stepoverPercent,
      vClearToolId: original.vClearToolId,
      pocketRoughToolId: original.pocketRoughToolId,
      reliefFinishToolId: original.reliefFinishToolId,
    });
    expect(useStore.getState().project.machine).toBe(before.project.machine);
    expect(useStore.getState().project.scene.layers[1]).toBe(before.project.scene.layers[1]);
    expect(useStore.getState().layerDefaults).toBe(before.layerDefaults);
    await act(async () => useStore.getState().createManualLayer('#445566'));
    const project = useStore.getState().project;
    const fresh = project.scene.layers.find((layer) => layer.color === '#445566');
    if (project.machine?.kind !== 'cnc' || fresh?.cnc === undefined)
      throw new Error('Fresh CNC operation missing');
    expect(fresh.cnc.materialKey).toBe('hardwood');
    expect(layerCncTool(project.machine, fresh.cnc).id).toBe(DEFAULT_CNC_MACHINE_CONFIG.toolId);
  });

  it('keeps Manual and the calculator consistent even when job stock has a material', async () => {
    await renderFields();
    await choose('Material', 'acrylic');
    const automatic = selectedSettings();
    await choose('Material', '');
    const { materialKey: _material, feedSource: _source, ...manual } = automatic;
    expect(selectedSettings()).toEqual(manual);
    expect(field('Material').value).toBe('');
    expect(
      host.querySelector('output[aria-label="Material for feeds calculator"]')?.textContent,
    ).toContain('Manual');
    const apply = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Apply to layer',
    );
    expect(apply?.disabled).toBe(true);
    await act(async () => useStore.getState().undo());
    expect(selectedSettings()).toEqual(automatic);
    expect(field('Material').value).toBe('acrylic');
  });

  it('keeps specialist bindings and the Startup tool plan consistent through save and reopen', async () => {
    await renderFields();
    await choose('Material', 'acrylic');
    await choose('Bit', 'em-1588');
    await choose('Pocket roughing bit', 'em-3175');
    const before = useStore.getState().project;
    const loaded = deserializeProject(serializeProject(before));
    if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
    expect(loaded.project.scene.layers[0]?.cnc).toEqual(selectedSettings());
    const selected = loaded.project.scene.layers[0];
    if (selected === undefined) throw new Error('Loaded operation missing');
    expect(cncStartupOperationDraft(selected)).toEqual({
      layerId: 'chosen',
      materialKey: 'acrylic',
      toolId: 'em-1588',
      vClearToolId: 'em-6350',
      pocketRoughToolId: 'em-3175',
      reliefFinishToolId: 'bn-3175',
    });
    expect(loaded.project.machine).toEqual(before.machine);
  });

  it('recalculates automatic feeds for the chosen bit while retaining other assignments', async () => {
    await renderFields();
    await choose('Material', 'hardwood');
    const before = selectedSettings();
    await choose('Bit', 'em-6350');
    expect(selectedSettings().feedMmPerMin).not.toBe(before.feedMmPerMin);
    expect(selectedSettings()).toMatchObject({
      toolId: 'em-6350',
      materialKey: 'hardwood',
      feedSource: { kind: 'material-recipe', materialKey: 'hardwood' },
      pocketRoughToolId: before.pocketRoughToolId,
      vClearToolId: before.vClearToolId,
      reliefFinishToolId: before.reliefFinishToolId,
    });
    expect(field('Pocket roughing bit').value).toBe('em-6350');
  });

  it('cancels a pending feed draft when a primary-bit choice keeps the same canonical numbers', async () => {
    vi.useFakeTimers();
    await renderFields();
    await draftFeed('1800');
    await choose('Bit', 'em-1588');
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(selectedSettings()).toMatchObject({ toolId: 'em-1588', feedMmPerMin: 731 });
    expect(feedInput().value).toBe('731');
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('retains a pending manual feed edit when only a secondary bit changes', async () => {
    vi.useFakeTimers();
    await renderFields({ toolId: 'em-1588' });
    await draftFeed('1800');
    await choose('Pocket roughing bit', 'em-3175');
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(selectedSettings()).toMatchObject({ pocketRoughToolId: 'em-3175', feedMmPerMin: 1800 });
    expect(feedInput().value).toBe('1800');
  });
});
