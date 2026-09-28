import type { SettingsCommandId } from '../commands/settings-command-types';
import type { CommandHelpTopic } from './command-help-topics';

// Edit → Settings (LightBurn gap LBG-F18).
export const SETTINGS_COMMAND_HELP: Readonly<Record<SettingsCommandId, CommandHelpTopic>> = {
  'edit.settings': {
    family: 'edit',
    tooltip:
      'Open the Settings window (Ctrl+, or Cmd+,): theme, workspace layout, recent projects, snapping and grid, start markers, arrow-key nudge distances and Labs, with links to Machine Setup and your materials. Changes apply at once and stay on this computer; none is saved in a project.',
  },
};
