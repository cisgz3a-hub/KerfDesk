import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { AdvancedArtworkSettings } from './AdvancedArtworkSettings';
import { SelectedOperationInspector } from './SelectedOperationInspector';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  useUiStore.setState({ editedArtwork: null });
  document.body.replaceChildren();
});

// Two pieces share one operation; a third has its own.
function loadFixture(chosenOverridesPower: boolean): void {
  const shared = createLayer({ id: 'shared', color: '#000000' });
  const other = createLayer({ id: 'other', color: '#2563eb' });
  const objects: SceneObject[] = [
    {
      ...svgObj('chosen', ['#000000']),
      operationIds: ['shared'],
      ...(chosenOverridesPower ? { operationOverride: { power: 17 } } : {}),
    },
    { ...svgObj('peer', ['#000000']), operationIds: ['shared'] },
    { ...svgObj('elsewhere', ['#2563eb']), operationIds: ['other'] },
  ];
  useStore.setState({
    project: { ...createProject(), scene: { objects, layers: [shared, other] } },
    selectedObjectId: 'chosen',
    additionalSelectedIds: new Set(),
  });
}

function Inspector(): JSX.Element {
  const objects = useStore((state) => state.project.scene.objects);
  const layers = useStore((state) => state.project.scene.layers);
  const chosen = objects.filter((object) => object.id === 'chosen');
  return (
    <>
      <SelectedOperationInspector objects={chosen} selectionActive />
      <AdvancedArtworkSettings objects={chosen} layers={layers} selectionActive />
      <button type="button">Elsewhere</button>
    </>
  );
}

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Inspector />));
  return { host, unmount: async () => act(async () => root.unmount()) };
}

function field(host: HTMLElement, label: string): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label^="${label}"]`);
  if (input === null) throw new Error(`${label} field missing`);
  return input;
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (each) => each.textContent?.trim() === text,
  );
  if (found === undefined) throw new Error(`${text} button missing`);
  return found;
}

const edited = () => useUiStore.getState().editedArtwork;

describe('settings edit glow', () => {
  it('lights every piece an operation edit changes while focus is in the settings', async () => {
    loadFixture(false);
    const { host, unmount } = await mount();
    expect(edited()).toBeNull();

    await act(async () => field(host, 'Power for ').focus());
    expect(edited()).toEqual({
      owner: 'operation-editor:shared',
      objectIds: ['chosen', 'peer'],
      operationIds: ['shared'],
    });

    // Moving between controls of the same editor keeps the glow.
    const before = edited();
    await act(async () => field(host, 'Speed for ').focus());
    expect(edited()).toBe(before);

    const elsewhere = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Elsewhere',
    );
    await act(async () => elsewhere?.focus());
    expect(document.activeElement).toBe(elsewhere);
    expect(edited()).toBeNull();
    await unmount();
  });

  it('lights only the selected piece while it edits its own settings', async () => {
    loadFixture(true);
    const { host, unmount } = await mount();
    await act(async () => field(host, 'Power for ').focus());
    expect(edited()?.objectIds).toEqual(['chosen']);
    await unmount();
  });

  it('ends the glow on a press outside the editor, and when the editor goes away', async () => {
    loadFixture(false);
    const { host, unmount } = await mount();
    await act(async () => field(host, 'Power for ').focus());
    // No blur follows this press, so the edit ends right after it.
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(edited()).toBeNull();

    await act(async () => field(host, 'Speed for ').blur());
    await act(async () => field(host, 'Speed for ').focus());
    expect(edited()).not.toBeNull();
    await unmount();
    expect(edited()).toBeNull();
  });

  it('lights every piece from Include in output, even while the selection has its own settings', async () => {
    loadFixture(true);
    const { host, unmount } = await mount();
    await act(async () => field(host, 'Power for ').focus());
    expect(edited()?.objectIds).toEqual(['chosen']);
    // Output and visibility change the operation for every piece using it.
    await act(async () => field(host, 'Output ').focus());
    expect(edited()?.objectIds).toEqual(['chosen', 'peer']);
    await act(async () => field(host, 'Show ').focus());
    expect(edited()?.objectIds).toEqual(['chosen', 'peer']);
    // A rename names the operation for every piece using it.
    await act(async () => field(host, 'Operation name').focus());
    expect(edited()?.objectIds).toEqual(['chosen', 'peer']);
    await act(async () => field(host, 'Speed for ').focus());
    expect(edited()?.objectIds).toEqual(['chosen']);
    await unmount();
  });

  it('lights only the selected piece from Make unique and Add operation', async () => {
    loadFixture(false);
    const { host, unmount } = await mount();
    await act(async () => field(host, 'Power for ').focus());
    expect(edited()?.objectIds).toEqual(['chosen', 'peer']);
    // Both act on the selected artwork only.
    await act(async () => button(host, 'Make unique').focus());
    expect(edited()?.objectIds).toEqual(['chosen']);
    await act(async () => button(host, 'Add operation').focus());
    expect(edited()?.objectIds).toEqual(['chosen']);
    await unmount();
  });

  it('keeps the edit through the commit an outside press blurs, then ends it with the blur', async () => {
    loadFixture(false);
    const { host, unmount } = await mount();
    const outside = button(host, 'Elsewhere');
    const power = field(host, 'Power for ');
    await act(async () => power.focus());
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(power, '42');
      power.dispatchEvent(new Event('input', { bubbles: true }));
    });
    let heldAtCommit: boolean | null = null;
    const stop = useStore.subscribe((state, previous) => {
      if (state.project.scene !== previous.project.scene) heldAtCommit = edited() !== null;
    });
    // The press, then the blur it causes: the field commits on blur.
    await act(async () => {
      outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      outside.focus();
    });
    stop();
    expect(useStore.getState().project.scene.layers[0]?.power).toBe(42);
    expect(heldAtCommit).toBe(true);
    // Ended with the blur, before the pressed control's click could act.
    expect(edited()).toBeNull();
    await unmount();
  });

  it.each(['Make unique', 'Add operation'])(
    'ends the glow when %s moves the editor to the new operation',
    async (action) => {
      loadFixture(false);
      const { host, unmount } = await mount();
      const control = button(host, action);
      await act(async () => control.focus());
      expect(edited()?.objectIds).toEqual(['chosen']);
      // The editor remounts on the new operation, without focus (ADR-646 rule 5).
      await act(async () => control.click());
      const chosen = useStore
        .getState()
        .project.scene.objects.find((object) => object.id === 'chosen');
      expect(chosen?.operationIds).not.toEqual(['shared']);
      expect(edited()).toBeNull();
      await unmount();
    },
  );

  it('lights every piece of the operations a multi-operation CNC depth edit changes', async () => {
    const cut = { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave' as const, depthMm: 1 };
    const objects: SceneObject[] = [
      { ...svgObj('first', ['#000000']), operationIds: ['one'] },
      { ...svgObj('second', ['#2563eb']), operationIds: ['two'] },
      { ...svgObj('unselected', ['#000000']), operationIds: ['one'] },
      { ...svgObj('bystander', ['#16a34a']), operationIds: ['three'] },
    ];
    useStore.getState().setMachineKind('cnc');
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          objects,
          layers: [
            { ...createLayer({ id: 'one', color: '#000000' }), cnc: cut },
            { ...createLayer({ id: 'two', color: '#2563eb' }), cnc: { ...cut, depthMm: 2 } },
            { ...createLayer({ id: 'three', color: '#16a34a' }), cnc: cut },
          ],
        },
      },
    }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const selected = objects.slice(0, 2);
    await act(async () =>
      root.render(<SelectedOperationInspector objects={selected} selectionActive />),
    );
    await act(async () => field(host, 'Cut depth for selected operations').focus());
    expect(edited()).toEqual({
      owner: 'cnc-selection-depth',
      objectIds: ['first', 'second', 'unselected'],
      operationIds: ['one', 'two'],
    });
    await act(async () => root.unmount());
    expect(edited()).toBeNull();
  });

  it('lights the selected artwork in all its operations from the power multiplier', async () => {
    loadFixture(false);
    const { host, unmount } = await mount();
    // Opening the disclosure changes nothing, so its toggle lights nothing.
    const summary = host.querySelector<HTMLElement>('summary[title^="Adjust power"]');
    await act(async () => summary?.focus());
    expect(document.activeElement).toBe(summary);
    expect(edited()).toBeNull();
    await act(async () => field(host, 'Power multiplier for ').focus());
    expect(edited()).toEqual({
      owner: 'artwork-power-multiplier',
      objectIds: ['chosen'],
      operationIds: ['shared'],
    });
    // Closing it from the toggle ends the glow.
    await act(async () => summary?.focus());
    expect(edited()).toBeNull();
    await unmount();
  });
});
