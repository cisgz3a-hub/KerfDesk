// Job Review laser cards edit in place (ADR-224 v3): values stay read-only
// until Edit, nothing reaches the main settings before Save, Save clamps like
// the panels and rebuilds, and Discard or Escape drops the draft without
// closing the review.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createLayerSubLayer,
  createProject,
  EMPTY_SCENE,
  type Layer,
} from '../../../core/scene';
import { feedCeilingMessage } from '../../layers/feed-ceiling';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { useToastStore } from '../../state/toast-store';
import { JobReviewOperations } from './JobReviewOperations';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host.remove();
  resetStore();
  useToastStore.setState({ toasts: [] });
});

function seedLayers(layers: ReadonlyArray<Layer>): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: { ...EMPTY_SCENE, objects: [], layers: [...layers] },
    },
  });
}

type Callbacks = Pick<
  React.ComponentProps<typeof JobReviewOperations>,
  'onSaved' | 'onEditingChange'
>;

async function render(callbacks: Callbacks = {}): Promise<void> {
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <JobReviewOperations machineKind="laser" effectiveOperations={[]} {...callbacks} />,
    );
  });
}

function numberInput(label: string): HTMLInputElement {
  const input = host.querySelector(`input[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input "${label}" not found`);
  return input;
}

function shownValue(label: string): string | null | undefined {
  return host.querySelector(`output[aria-label="${label}"]`)?.textContent;
}

function button(text: string, scope: ParentNode = host): HTMLButtonElement {
  const match = [...scope.querySelectorAll('button')].find((b) => b.textContent === text);
  if (match === undefined) throw new Error(`Button "${text}" not found`);
  return match;
}

async function click(target: HTMLElement): Promise<void> {
  await act(async () => target.click());
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function press(target: HTMLElement, key: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function storedLayer(id: string): Layer {
  const layer = useStore.getState().project.scene.layers.find((entry) => entry.id === id);
  if (layer === undefined) throw new Error(`Layer ${id} missing from the store`);
  return layer;
}

describe('Job Review laser card editing', () => {
  it('shows values read-only until Edit, then saves them to the main settings with clamping', async () => {
    const layer = createLayer({ id: 'red', color: '#ff0000' });
    seedLayers([layer]);
    const saved: string[] = [];
    const editing: Array<[string, boolean]> = [];
    await render({
      onSaved: () => saved.push('saved'),
      onEditingChange: (id, isEditing) => editing.push([id, isEditing]),
    });
    expect(host.querySelectorAll('input')).toHaveLength(0);
    expect(shownValue(`Power % for ${layer.name}`)).toBe(String(layer.power));
    expect(shownValue(`Air assist for ${layer.name}`)).toBe('Off');

    await click(button('Edit'));
    expect(editing).toEqual([['red', true]]);
    await type(numberInput(`Power % for ${layer.name}`), '55');
    await type(numberInput(`Speed mm/min for ${layer.name}`), '999999');
    await type(numberInput(`Passes for ${layer.name}`), '2.7');
    await click(numberInput(`Air assist for ${layer.name}`));
    // Nothing reaches the main settings before Save.
    expect(storedLayer('red').power).toBe(layer.power);
    await click(button('Save'));

    const maxFeed = useStore.getState().project.device.maxFeed;
    expect(storedLayer('red')).toMatchObject({
      power: 55,
      speed: maxFeed,
      passes: 2,
      airAssist: true,
    });
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(feedCeilingMessage(maxFeed));
    expect(saved).toEqual(['saved']);
    expect(editing).toEqual([
      ['red', true],
      ['red', false],
    ]);
    expect(host.querySelectorAll('input')).toHaveLength(0);
    expect(shownValue(`Power % for ${layer.name}`)).toBe('55');
    expect(host.textContent).toContain('Saved');
  });

  it('writes only the values whose fields were changed, leaving an untouched speed as stored', async () => {
    const maxFeed = useStore.getState().project.device.maxFeed;
    // Stored above Output max feed (lowered after the speed was set): the
    // compiler caps it at output, so the review must not rewrite it.
    const layer = { ...createLayer({ id: 'red', color: '#ff0000' }), speed: maxFeed + 2000 };
    seedLayers([layer]);
    await render();

    await click(button('Edit'));
    await type(numberInput(`Power % for ${layer.name}`), '42');
    await click(button('Save'));

    expect(storedLayer('red')).toMatchObject({ power: 42, speed: maxFeed + 2000 });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('keeps the card editing and the store unchanged when a number is not valid', async () => {
    const layer = createLayer({ id: 'red', color: '#ff0000' });
    seedLayers([layer]);
    await render();
    await click(button('Edit'));
    const input = numberInput(`Power % for ${layer.name}`);

    await type(input, '1e2');
    await click(button('Save'));

    expect(storedLayer('red').power).toBe(layer.power);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('decimal point');
    expect(button('Save')).toBeInstanceOf(HTMLButtonElement);
  });

  it('drops the draft on Discard and on Escape without closing anything else', async () => {
    const layer = createLayer({ id: 'red', color: '#ff0000' });
    seedLayers([layer]);
    const outer = vi.fn();
    host.addEventListener('keydown', outer);
    await render();

    await click(button('Edit'));
    await type(numberInput(`Power % for ${layer.name}`), '80');
    await click(button('Discard'));
    expect(storedLayer('red').power).toBe(layer.power);
    expect(host.querySelectorAll('input')).toHaveLength(0);

    await click(button('Edit'));
    const power = numberInput(`Power % for ${layer.name}`);
    await type(power, '80');
    await press(power, 'Escape');
    expect(storedLayer('red').power).toBe(layer.power);
    expect(host.querySelectorAll('input')).toHaveLength(0);
    // The dialog's own Escape handler sits above the card and never sees it.
    expect(outer).not.toHaveBeenCalled();
  });

  it('saves on Enter and edits a sub-operation through its own settings', async () => {
    const base = createLayer({ id: 'red', color: '#ff0000' });
    const subLayer = createLayerSubLayer(base, { id: 'sub-1', label: 'Second pass' });
    seedLayers([{ ...base, subLayers: [subLayer] }]);
    await render();
    const card = host.querySelector(`article[aria-label="${base.name} Second pass settings"]`);
    if (card === null) throw new Error('Sub-operation card not found');

    await click(button('Edit', card));
    const power = numberInput(`Power % for ${base.name} Second pass`);
    await type(power, '21');
    await press(power, 'Enter');

    expect(storedLayer('red').subLayers[0]?.settings.power).toBe(21);
    expect(storedLayer('red').power).toBe(base.power);
  });
});
