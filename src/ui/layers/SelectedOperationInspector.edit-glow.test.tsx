import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createLayer, createProject, type SceneObject } from '../../core/scene';
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
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(edited()).toBeNull();

    await act(async () => field(host, 'Speed for ').blur());
    await act(async () => field(host, 'Speed for ').focus());
    expect(edited()).not.toBeNull();
    await unmount();
    expect(edited()).toBeNull();
  });

  it('lights the selected artwork in all its operations from the power multiplier', async () => {
    loadFixture(false);
    const { host, unmount } = await mount();
    await act(async () => field(host, 'Power multiplier for ').focus());
    expect(edited()).toEqual({
      owner: 'artwork-power-multiplier',
      objectIds: ['chosen'],
      operationIds: ['shared'],
    });
    await unmount();
  });
});
