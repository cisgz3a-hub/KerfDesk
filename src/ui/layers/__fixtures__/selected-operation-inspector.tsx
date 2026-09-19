import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  captureLayerOperationSettings,
  createLayer,
  createProject,
  type LayerOperationSettings,
} from '../../../core/scene';
import { effectiveOperationForObject } from '../../../core/scene/effective-operation';
import { useStore } from '../../state';
import { svgObj } from '../../state/test-helpers';
import { SelectedOperationInspector } from '../SelectedOperationInspector';

export const FIRST: Partial<LayerOperationSettings> = {
  power: 17,
  minPower: 5,
  speed: 601,
  passes: 1,
  hatchAngleDeg: 0,
  hatchSpacingMm: 0.1,
  fillOverscanMm: 3,
  fillBidirectional: false,
  airAssist: false,
};
export const SECOND: Partial<LayerOperationSettings> = {
  power: 83,
  minPower: 11,
  speed: 1801,
  passes: 3,
  hatchAngleDeg: 45,
  hatchSpacingMm: 0.2,
  fillOverscanMm: 5,
  fillBidirectional: true,
  airAssist: true,
};

// eslint-disable-next-line no-restricted-syntax -- Scene artwork color in a test fixture, not UI chrome.
const ARTWORK_COLOR = '#000000';

export function load(
  first: Partial<LayerOperationSettings>,
  second: Partial<LayerOperationSettings>,
) {
  const layer = { ...createLayer({ id: 'shared', color: ARTWORK_COLOR }), mode: 'fill' as const };
  const objects = [first, second].map((patch, index) => ({
    ...svgObj(`art-${index}`, [ARTWORK_COLOR]),
    operationIds: [layer.id],
    operationOverride: patch,
  }));
  useStore.setState({
    project: { ...createProject(), scene: { layers: [layer], objects } },
    selectedObjectId: 'art-0',
    additionalSelectedIds: new Set(['art-1']),
    dirty: false,
    undoStack: [],
    redoStack: [],
  });
}
export function effective() {
  const { scene } = useStore.getState().project;
  const layer = scene.layers[0];
  if (layer === undefined) throw new Error('Missing fixture operation');
  return scene.objects.map((object) =>
    captureLayerOperationSettings(effectiveOperationForObject(layer, object)),
  );
}
function Harness() {
  const objects = useStore((state) => state.project.scene.objects);
  return <SelectedOperationInspector objects={objects} selectionActive />;
}
export async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Harness />));
  return { host, unmount: async () => act(async () => root.unmount()) };
}
export function field(host: HTMLElement, label: string) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label^="${label} for"]`);
  if (!input) throw new Error(`Missing ${label}`);
  return input;
}
export async function blur(input: HTMLInputElement) {
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
}
export async function edit(input: HTMLInputElement, value: string) {
  await type(input, value);
  await blur(input);
}
export async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setValue === undefined) throw new Error('Missing native input setter');
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
export async function openAdvanced(host: HTMLElement) {
  const button = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Advanced cut settings',
  );
  if (button === undefined) throw new Error('Missing Advanced settings button');
  await act(async () => button.click());
}
