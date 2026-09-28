// Edit → Settings... (LightBurn gap LBG-F18). LightBurn keeps its settings
// under Edit; Ctrl/Cmd+, is the desktop convention Rayforge also follows. The
// window itself is src/ui/settings/SettingsDialog.tsx.

import { openSettings } from '../settings/settings-dialog-store';
import { enabled, type AppCommand, type AppCommandContext } from './command-types';
import type { SettingsCommandContext } from './settings-command-types';

export const SETTINGS_SHORTCUT = 'Ctrl+,';

export function settingsCommand(ctx: AppCommandContext): AppCommand {
  return enabled(
    'edit.settings',
    'edit',
    'Settings...',
    'Theme, layout, snapping, nudge distances and other app preferences',
    ctx.openSettings,
    SETTINGS_SHORTCUT,
  );
}

export function settingsCommandContext(): SettingsCommandContext {
  return { openSettings: () => openSettings() };
}
