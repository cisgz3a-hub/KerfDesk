// The Cut Settings dialog opened by "More cut settings" lights the artwork its
// edit changes (ADR-646 Amendment 1). The dialog renders inside the Operation
// editor, so the editor's glow covers it; these tests keep it that way.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createLayer, createProject, type SceneObject } from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { SelectedOperationInspector } from './SelectedOperationInspector';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  useUiStore.setState({ editedArtwork: null });
  document.body.replaceChildren();
});

// Three pieces share one operation; a fourth has its own.
function loadFixture(options: {
  readonly selected: ReadonlyArray<string>;
  readonly chosenOverridesPower: boolean;
}): void {
  const shared = createLayer({ id: 'shared', color: '#000000' });
  const other = createLayer({ id: 'other', color: '#2563eb' });
  const objects: SceneObject[] = [
    {
      ...svgObj('chosen', ['#000000']),
      operationIds: ['shared'],
      ...(options.chosenOverridesPower ? { operationOverride: { power: 17 } } : {}),
    },
    { ...svgObj('peer', ['#000000']), operationIds: ['shared'] },
    { ...svgObj('bystander', ['#000000']), operationIds: ['shared'] },
    { ...svgObj('elsewhere', ['#2563eb']), operationIds: ['other'] },
  ];
  const [first, ...rest] = options.selected;
  useStore.setState({
    project: { ...createProject(), scene: { objects, layers: [shared, other] } },
    selectedObjectId: first ?? null,
    additionalSelectedIds: new Set(rest),
  });
}

function Inspector(props: { readonly selected: ReadonlyArray<string> }): JSX.Element {
  const objects = useStore((state) => state.project.scene.objects);
  return (
    <>
      <SelectedOperationInspector
        objects={objects.filter((object) => props.selected.includes(object.id))}
        selectionActive
      />
      <button type="button">Elsewhere</button>
    </>
  );
}

async function mountWithDialog(selected: ReadonlyArray<string>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Inspector selected={selected} />));
  const more = host.querySelector<HTMLButtonElement>('button[aria-label="More cut settings"]');
  if (more === null) throw new Error('More cut settings missing');
  await act(async () => more.focus());
  await act(async () => more.click());
  const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog === null) throw new Error('Cut Settings dialog missing');
  return { host, dialog, more, unmount: async () => act(async () => root.unmount()) };
}

function dialogInput(dialog: HTMLElement, name: string): HTMLInputElement {
  const input = dialog.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (input === null) throw new Error(`${name} field missing`);
  return input;
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setValue?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function press(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  });
}

const edited = () => useUiStore.getState().editedArtwork;
const scene = () => useStore.getState().project.scene;

describe('Cut Settings dialog edit glow', () => {
  it('lights every piece of the operation while focus is in the dialog', async () => {
    loadFixture({ selected: ['chosen'], chosenOverridesPower: false });
    const { host, dialog, more, unmount } = await mountWithDialog(['chosen']);
    expect(dialog.contains(document.activeElement)).toBe(true);
    const lit = {
      owner: 'operation-editor:shared',
      objectIds: ['chosen', 'peer', 'bystander'],
      operationIds: ['shared'],
    };
    expect(edited()).toEqual(lit);

    // Pressing and typing inside the dialog keep the same glow.
    const before = edited();
    const power = dialogInput(dialog, 'power');
    await press(power);
    await act(async () => power.focus());
    await type(power, '42');
    expect(edited()).toBe(before);

    // Apply changes the operation, and the glow stays as focus returns to the editor.
    await act(async () => dialog.querySelector('form')?.requestSubmit());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(scene().layers.find((layer) => layer.id === 'shared')?.power).toBe(42);
    expect(document.activeElement).toBe(more);
    expect(edited()).toEqual(lit);

    const elsewhere = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Elsewhere',
    );
    await act(async () => elsewhere?.focus());
    expect(edited()).toBeNull();
    await unmount();
  });

  it('lights only the selected pieces while the dialog edits their own settings', async () => {
    loadFixture({ selected: ['chosen', 'peer'], chosenOverridesPower: true });
    const { dialog, unmount } = await mountWithDialog(['chosen', 'peer']);
    expect(edited()).toEqual({
      owner: 'operation-editor:shared',
      objectIds: ['chosen', 'peer'],
      operationIds: ['shared'],
    });

    // The lit pieces are exactly the ones Apply changes.
    const power = dialogInput(dialog, 'power');
    await act(async () => power.focus());
    await type(power, '42');
    await act(async () => dialog.querySelector('form')?.requestSubmit());
    const shared = scene().layers.find((layer) => layer.id === 'shared');
    if (shared === undefined) throw new Error('shared operation missing');
    const powerOf = (id: string) => {
      const object = scene().objects.find((candidate) => candidate.id === id);
      return object === undefined ? undefined : effectiveOperationForObject(shared, object).power;
    };
    expect(powerOf('chosen')).toBe(42);
    expect(powerOf('peer')).toBe(42);
    expect(powerOf('bystander')).toBe(shared.power);
    expect(shared.power).not.toBe(42);
    expect(edited()?.objectIds).toEqual(['chosen', 'peer']);
    await unmount();
  });

  it('keeps the glow when Cancel closes the dialog and focus returns to the editor', async () => {
    loadFixture({ selected: ['chosen'], chosenOverridesPower: false });
    const { dialog, more, unmount } = await mountWithDialog(['chosen']);
    const before = edited();
    const cancel = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel',
    );
    await act(async () => cancel?.focus());
    await act(async () => cancel?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(document.activeElement).toBe(more);
    expect(edited()).toBe(before);
    await unmount();
  });

  it('ends the glow when the dialog closes with its editor', async () => {
    loadFixture({ selected: ['chosen'], chosenOverridesPower: false });
    const { unmount } = await mountWithDialog(['chosen']);
    expect(edited()).not.toBeNull();
    await unmount();
    expect(edited()).toBeNull();
  });
});
