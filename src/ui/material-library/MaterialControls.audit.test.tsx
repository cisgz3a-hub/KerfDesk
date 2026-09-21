import { describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { MaterialLibraryPanel } from '../layers/MaterialLibraryPanel';
import {
  auditPlatform,
  button,
  change,
  click,
  input,
  mount,
} from '../layers/control-audit-test-support';
import { SavedLibrariesButton } from './SavedLibrariesButton';
import { defaultRecipe } from './wizard/wizard-recipe';
import { svgObj } from '../state/test-helpers';

describe('artwork control audit: material management', () => {
  it('links the selected preset with its source revision to the target operation', async () => {
    useStore.getState().createLibrary('Shop');
    useStore.getState().upsertMaterialPreset({
      id: 'birch',
      materialName: 'Birch',
      thicknessMm: 3,
      description: 'Cut',
      revision: 'audit-r1',
      recipe: { ...defaultRecipe(), power: 61 },
    });
    useStore.getState().importSvgObject(svgObj('Part', ['#000000']));
    const libraryId = useStore.getState().materialLibrary!.libraryId;
    const host = await mount(<MaterialLibraryPanel />);
    await click(button(host, 'Link selected material preset to layer'));
    expect(useStore.getState().project.scene.layers[0]).toMatchObject({
      power: 61,
      materialBinding: { libraryId, presetId: 'birch', presetRevision: 'audit-r1' },
    });
  });
  it('opens saved libraries creates a blank library cancels rename and closes the dialog', async () => {
    useStore.getState().createLibrary('Original');
    const host = await mount(<SavedLibrariesButton />);
    await click(button(host, 'Open saved libraries'));
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await click(button(host, 'Rename Original'));
    await change(input(host, 'input[aria-label="Rename Original"]'), 'Discarded');
    await click(button(host, 'Cancel renaming Original'));
    expect(useStore.getState().materialLibrary?.name).toBe('Original');
    expect(host.querySelector('input[aria-label="Rename Original"]')).toBeNull();
    await click(button(host, 'New library'));
    expect(useStore.getState().listSavedLibraries()).toHaveLength(2);
    expect(useStore.getState().materialLibrary?.entries).toEqual([]);
    const active = useStore.getState().materialLibrary!;
    expect(button(host, `Open ${active.name}`).disabled).toBe(true);
    await click(button(host, 'Close'));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('imports CLB through the button and stores parsed units using a stub file picker', async () => {
    const xml =
      '<Library><Material Name="Birch"><Entry Thickness="3" Desc="Cut"><CutSetting Speed="8" MaxPower="75" /></Entry></Material></Library>';
    const host = await mount(<SavedLibrariesButton />, {
      ...auditPlatform,
      pickFilesForOpen: async () => [{ name: 'shop.clb', text: async () => xml }],
    });
    await click(button(host, 'Open saved libraries'));
    await click(button(host, 'Import LightBurn CLB'));
    expect(useStore.getState().materialLibrary?.entries[0]).toMatchObject({
      materialName: 'Birch',
      thicknessMm: 3,
      recipe: { speed: 480, power: 75 },
    });
  });

  it('launches New and Edit saves surface identity air and tab flags and cancels an edit', async () => {
    useStore.getState().createLibrary('Shop');
    const host = await mount(<MaterialLibraryPanel />);
    expect(button(host, 'Edit selected material preset').disabled).toBe(true);
    await click(button(host, 'New material preset'));
    await change(input(host, 'input[aria-label="Material name"]'), 'Birch');
    await change(input(host, 'input[aria-label="Preset description"]'), 'Score');
    await click(input(host, 'input[aria-label="Surface, no thickness"]'));
    await change(input(host, 'input[aria-label="Surface title"]'), 'Surface score');
    await click(input(host, 'input[aria-label="Has thickness"]'));
    expect(host.querySelector('input[aria-label="Surface title"]')).toBeNull();
    await change(input(host, 'input[aria-label="Material thickness millimeters"]'), '3');
    await click(input(host, 'input[aria-label="Surface, no thickness"]'));
    expect(input(host, 'input[aria-label="Surface title"]').value).toBe('Surface score');
    await click(button(host, 'Next'));
    await click(input(host, 'input[name="airAssist"]'));
    await click(button(host, 'Next'));
    await click(input(host, 'input[name="tabsEnabled"]'));
    await click(input(host, 'input[name="tabSkipInnerShapes"]'));
    await click(button(host, 'Next'));
    expect(useStore.getState().materialLibrary?.entries).toHaveLength(0);
    await click(button(host, 'Save'));
    const saved = useStore.getState().materialLibrary?.entries[0];
    expect(saved).toMatchObject({
      title: 'Surface score',
      recipe: { airAssist: true, tabsEnabled: true, tabSkipInnerShapes: false },
    });
    expect(saved?.thicknessMm).toBeUndefined();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await click(button(host, 'Edit selected material preset'));
    expect(input(host, 'input[aria-label="Material name"]').value).toBe('Birch');
    await change(input(host, 'input[aria-label="Material name"]'), 'Discarded');
    await click(button(host, 'Cancel'));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(useStore.getState().materialLibrary?.entries[0]).toEqual(saved);
  });

  it('preserves settings and detail edits when Back is followed by Next', async () => {
    useStore.getState().createLibrary('Shop');
    const host = await mount(<MaterialLibraryPanel />);
    await click(button(host, 'New material preset'));
    await change(input(host, 'input[aria-label="Material name"]'), 'Birch');
    await change(input(host, 'input[aria-label="Material thickness millimeters"]'), '3');
    await change(input(host, 'input[aria-label="Preset description"]'), 'Cut');
    await click(button(host, 'Next'));
    await change(input(host, 'input[aria-label="Power"]'), '67');
    await click(input(host, 'input[name="airAssist"]'));
    await click(button(host, 'Back'));
    expect(input(host, 'input[aria-label="Material name"]').value).toBe('Birch');
    await click(button(host, 'Next'));
    expect(input(host, 'input[aria-label="Power"]').value).toBe('67');
    expect(input(host, 'input[name="airAssist"]').checked).toBe(true);
    await click(button(host, 'Next'));
    await click(input(host, 'input[name="tabsEnabled"]'));
    await click(button(host, 'Back'));
    await click(button(host, 'Next'));
    expect(input(host, 'input[name="tabsEnabled"]').checked).toBe(true);
    await click(button(host, 'Next'));
    await click(button(host, 'Save'));
    expect(useStore.getState().materialLibrary?.entries[0]?.recipe).toMatchObject({
      power: 67,
      airAssist: true,
      tabsEnabled: true,
    });
  });
});
