import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { primaryOperationForObject } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { AddLayerControls } from './AddLayerControls';
import { AssignSelectionButton } from './AssignSelectionButton';
import { CutsLayersPanel } from './CutsLayersPanel';
import { LayerSubLayers } from './LayerSubLayers';
import { SetupOwnedValueRow } from './SetupOwnedValueRow';
import {
  arrangeTwo,
  button,
  change,
  click,
  input,
  layer,
  mount,
} from './control-audit-test-support';

describe('artwork control audit: operations', () => {
  it('changes card visibility and output independently and opens More disclosure', async () => {
    arrangeTwo();
    const id = layer().id;
    const name = layer().name;
    const host = await mount(<CutsLayersPanel />);
    const card = host.querySelector<HTMLElement>(`section[aria-label="Operation ${name}"]`)!;
    await click(button(card, `Hide operation ${name}`));
    expect(layer().visible).toBe(false);
    expect(layer().output).toBe(true);
    const summary = card.querySelector('summary')!;
    await click(summary);
    expect(card.querySelector('details')?.open).toBe(true);
    await click(input(card, `input[aria-label="Show ${name}"]`));
    expect(layer().visible).toBe(true);
    await click(input(card, `input[aria-label="Output ${name}"]`));
    expect(useStore.getState().project.scene.layers.find((item) => item.id === id)?.output).toBe(
      false,
    );
    expect(layer().visible).toBe(true);
    await click(summary);
    expect(card.querySelector('details')?.open).toBe(false);
  });

  it('changes selected inspector Show and Output on the owning operation', async () => {
    arrangeTwo();
    const host = await mount(<CutsLayersPanel />);
    const target = layer(1);
    const inspector = host.querySelector<HTMLElement>('[aria-label="Selected artwork operation"]')!;
    await click(input(inspector, `input[aria-label="Show ${target.name}"]`));
    expect(layer(1).visible).toBe(false);
    expect(layer().visible).toBe(true);
    await click(input(inspector, `input[aria-label="Output ${target.name}"]`));
    expect(layer(1).output).toBe(false);
    expect(layer().output).toBe(true);
  });

  it('moves both directions with truthful end guards and pastes copied settings', async () => {
    arrangeTwo();
    const first = layer();
    const second = layer(1);
    useStore.getState().setLayerParam(first.id, { power: 64, speed: 987 });
    const host = await mount(<CutsLayersPanel />);
    expect(button(host, `Move ${first.name} up`).disabled).toBe(true);
    expect(button(host, `Move ${second.name} down`).disabled).toBe(true);
    expect(button(host, `Paste settings to ${second.color}`).disabled).toBe(true);
    await click(button(host, `Move ${first.name} down`));
    expect(layer().id).toBe(second.id);
    await click(button(host, `Move ${first.name} up`));
    expect(layer().id).toBe(first.id);
    await click(button(host, `Copy settings from ${first.color}`));
    expect(useStore.getState().copiedLayerSettings).toMatchObject({ power: 64, speed: 987 });
    expect(button(host, `Paste settings to ${second.color}`).disabled).toBe(false);
    await click(button(host, `Paste settings to ${second.color}`));
    expect(layer(1)).toMatchObject({ power: 64, speed: 987, id: second.id });
  });

  it('deletes only the chosen operation and its orphan artwork', async () => {
    arrangeTwo();
    const target = layer();
    const host = await mount(<CutsLayersPanel />);
    await click(button(host, `Delete operation ${target.name}`));
    expect(useStore.getState().project.scene.layers.map((item) => item.id)).not.toContain(
      target.id,
    );
    expect(useStore.getState().project.scene.objects.map((item) => item.id)).toEqual(['Second']);
    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project.scene.objects.map((item) => item.id)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('creates and assigns through the legacy standalone controls with no-selection guard', async () => {
    const host = await mount(<AddLayerControls />);
    input(host, '[name="newLayerColor"]').value = '#aabbcc';
    await click(button(host, 'Add layer'));
    expect(layer().color).toBe('#aabbcc');
    expect(useUiStore.getState().activeLayerColor).toBe('#aabbcc');
    const target = layer();
    const assign = await mount(<AssignSelectionButton layer={target} />);
    expect(button(assign, `Assign selection to ${target.color}`).disabled).toBe(true);
    await act(async () => arrangeTwo());
    await click(button(assign, `Assign selection to ${target.color}`));
    const scene = useStore.getState().project.scene;
    expect(
      primaryOperationForObject(scene.objects.find((item) => item.id === 'Second')!, scene.layers)
        ?.id,
    ).toBe(target.id);
  });

  it('adds disables edits and deletes a legacy sub-layer without changing primary settings', async () => {
    arrangeTwo();
    const targetId = layer().id;
    function LegacySubLayers() {
      const target = useStore(
        (state) => state.project.scene.layers.find((item) => item.id === targetId)!,
      );
      return <LayerSubLayers layer={target} />;
    }
    const host = await mount(<LegacySubLayers />);
    await click(button(host, `Add sub-layer for ${layer().color}`));
    expect(layer().subLayers).toHaveLength(1);
    const sub = layer().subLayers[0]!;
    await click(input(host, `input[aria-label="Enable ${sub.label} for ${layer().color}"]`));
    expect(layer().subLayers[0]?.enabled).toBe(false);
    await click(button(host, `Edit ${sub.label} for ${layer().color}`));
    await change(input(host, 'input[aria-label="Cut settings power"]'), '57');
    await click(button(host, 'OK'));
    expect(layer().subLayers[0]?.settings.power).toBe(57);
    expect(layer().power).toBe(30);
    await click(button(host, `Delete ${sub.label} for ${layer().color}`));
    expect(layer().subLayers).toHaveLength(0);
  });

  it('closes the setup explanation without opening a setup editor or mutating the project', async () => {
    const project = useStore.getState().project;
    const host = await mount(
      <SetupOwnedValueRow
        label="Machine maximum"
        value="10000"
        description="Setup owns this"
        setupField="spindle-max"
      />,
    );
    await click(button(host, 'Machine maximum: 10000. Managed in Startup Setup.'));
    expect(host.querySelector('[role="note"]')).not.toBeNull();
    await click(button(host, 'Close'));
    expect(host.querySelector('[role="note"]')).toBeNull();
    expect(
      button(host, 'Machine maximum: 10000. Managed in Startup Setup.').getAttribute(
        'aria-expanded',
      ),
    ).toBe('false');
    expect(useStore.getState().project).toBe(project);
  });
});
