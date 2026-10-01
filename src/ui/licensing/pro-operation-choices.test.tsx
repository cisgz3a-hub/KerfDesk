import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS, type CncLayerSettings } from '../../core/scene';
import { LayerSettingsClipboardButtons } from '../layers/LayerSettingsClipboardButtons';
import { SelectedOperationInspector } from '../layers/SelectedOperationInspector';
import { useStore } from '../state/store';
import { resetStore, svgObj } from '../state/test-helpers';
import { EditionContext, setActiveEdition, UNRESTRICTED_EDITION } from './edition';

let host: HTMLDivElement;
let root: Root;
const asked = vi.fn(() => false);
const free = { ...UNRESTRICTED_EDITION, licensed: true, pro: false, requestPro: asked };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  resetStore();
  asked.mockClear();
  setActiveEdition(UNRESTRICTED_EDITION);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  useStore.getState().setMachineKind('cnc');
  useStore.getState().importSvgObject(svgObj('Existing Pro artwork', ['#000000']));
  useStore.getState().importSvgObject(svgObj('New Free artwork', ['#000000']));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
  setActiveEdition(null);
  vi.unstubAllGlobals();
});

const CHOICES: ReadonlyArray<readonly [string, Partial<CncLayerSettings>]> = [
  ['vcarve', { cutType: 'v-carve' }],
  ['adaptive-clearing', { cutType: 'pocket', pocketStrategy: 'adaptive' }],
];

function seedPro(cnc: Partial<CncLayerSettings>): { sourceId: string; targetId: string } {
  const [source, target] = useStore.getState().project.scene.layers;
  if (source === undefined || target === undefined) throw new Error('Missing artwork operations');
  useStore.getState().setLayerParam(source.id, { cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc } });
  setActiveEdition(free);
  return { sourceId: source.id, targetId: target.id };
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  if (found === undefined) throw new Error(`Missing button: ${label}`);
  return found;
}

it.each(CHOICES)('asks before sharing %s onto new Free artwork', async (feature, cnc) => {
  seedPro(cnc);
  const before = useStore.getState().project;
  await act(async () =>
    root.render(
      <EditionContext.Provider value={free}>
        <SelectedOperationInspector objects={before.scene.objects} selectionActive />
      </EditionContext.Provider>,
    ),
  );
  await act(async () => button('Use one operation for selection').click());
  expect(useStore.getState().project).toBe(before);
  expect(asked).toHaveBeenCalledExactlyOnceWith(feature, expect.any(Function));
});

it.each(CHOICES)('asks before pasting %s settings onto a Free operation', async (feature, cnc) => {
  const { sourceId, targetId } = seedPro(cnc);
  useStore.getState().copyLayerSettings(sourceId);
  const before = useStore.getState().project;
  const target = before.scene.layers.find((layer) => layer.id === targetId);
  if (target === undefined) throw new Error('Missing target operation');
  await act(async () =>
    root.render(
      <EditionContext.Provider value={free}>
        <LayerSettingsClipboardButtons layer={target} />
      </EditionContext.Provider>,
    ),
  );
  await act(async () => button('Paste').click());
  expect(useStore.getState().project).toBe(before);
  expect(asked).toHaveBeenCalledExactlyOnceWith(feature, expect.any(Function));
});
