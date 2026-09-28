import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAppCommands, runCommand } from '../commands/command-registry';
import { baseCtx } from '../commands/command-registry-test-helpers';
import { settingsCommandContext } from '../commands/settings-command';
import { shortcutFamilies } from '../common/shortcut-list';
import { useSettingsDialogStore } from '../settings/settings-dialog-store';
import { handleSettingsShortcut } from './settings-shortcut';

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { cancelable: true, ...init });
}

afterEach(() => {
  useSettingsDialogStore.setState({ open: false, section: 'general' });
});

describe('Settings shortcut (LBG-F18)', () => {
  it('Ctrl+, and Cmd+, open Settings', () => {
    for (const init of [
      { key: ',', ctrlKey: true },
      { key: ',', metaKey: true },
    ]) {
      const open = vi.fn();
      const event = keydown(init);
      expect(handleSettingsShortcut(event, open)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(open).toHaveBeenCalledOnce();
    }
  });

  it('leaves a bare comma (rotate), Ctrl+. (Abort) and AltGr chords alone', () => {
    const open = vi.fn();
    for (const init of [
      { key: ',' },
      { key: '.', ctrlKey: true },
      { key: ',', ctrlKey: true, altKey: true },
      { key: ',', ctrlKey: true, shiftKey: true },
    ]) {
      const event = keydown(init);
      expect(handleSettingsShortcut(event, open)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('Edit → Settings... is always enabled, shows Ctrl+, and opens the window', () => {
    const openSettings = vi.fn();
    const command = buildAppCommands(baseCtx({ openSettings })).find(
      (entry) => entry.id === 'edit.settings',
    );
    expect(command).toMatchObject({
      family: 'edit',
      label: 'Settings...',
      shortcut: 'Ctrl+,',
      enabled: true,
    });
    if (command === undefined) throw new Error('edit.settings missing');
    runCommand(command);
    expect(openSettings).toHaveBeenCalledOnce();
  });

  it('the live command context opens the shared Settings store', () => {
    settingsCommandContext().openSettings();
    expect(useSettingsDialogStore.getState().open).toBe(true);
  });

  it('is listed in the keyboard shortcut reference', () => {
    const edit = shortcutFamilies('laser').find((family) => family.family === 'Edit');
    expect(edit?.rows).toContainEqual({ keys: 'Ctrl+,', action: 'settings' });
  });
});
