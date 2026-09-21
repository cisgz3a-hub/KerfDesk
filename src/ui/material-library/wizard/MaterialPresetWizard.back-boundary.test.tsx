import { describe, expect, it } from 'vitest';
import { MaterialLibraryPanel } from '../../layers/MaterialLibraryPanel';
import { button, change, click, input, mount } from '../../layers/control-audit-test-support';
import { useStore } from '../../state';
import { defaultRecipe } from './wizard-recipe';

describe('material preset Back data boundary', () => {
  it('normalizes invalid numeric drafts locally and Cancel retains the exact saved preset', async () => {
    useStore.getState().createLibrary('Audit');
    useStore.getState().upsertMaterialPreset({
      id: 'existing',
      materialName: 'Birch',
      thicknessMm: 3,
      description: 'Cut',
      revision: 'saved-r1',
      recipe: { ...defaultRecipe(), power: 72, speed: 654, airAssist: false },
    });
    const saved = useStore.getState().materialLibrary;
    const host = await mount(<MaterialLibraryPanel />);
    await click(button(host, 'Edit selected material preset'));
    await click(button(host, 'Next'));
    const power = input(host, '[aria-label="Power"]');
    await change(power, '130');
    await change(input(host, '[aria-label="Speed"]'), '');
    await click(input(host, '[name="airAssist"]'));
    expect(power.validity.rangeOverflow).toBe(true);
    await click(button(host, 'Back'));
    expect(useStore.getState().materialLibrary).toBe(saved);
    await click(button(host, 'Next'));
    expect(input(host, '[aria-label="Power"]').value).toBe('100');
    expect(input(host, '[aria-label="Speed"]').value).toBe('654');
    expect(input(host, '[name="airAssist"]').checked).toBe(true);
    await click(button(host, 'Cancel'));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(useStore.getState().materialLibrary).toBe(saved);
    expect(saved?.entries[0]).toMatchObject({
      revision: 'saved-r1',
      recipe: { power: 72, speed: 654, airAssist: false },
    });
  });
});
