import type { AppThemePreference } from '../theme/app-theme';
import { enabled, type AppCommand, type AppCommandContext } from './command-types';

// Appearance (ADR-339). KerfDesk opens light on every machine; these three are
// the only way dark is reached, so they behave as a radio group — `active`
// marks the one in force rather than toggling independently.
const THEME_CHOICES: ReadonlyArray<{
  readonly preference: AppThemePreference;
  readonly id: 'window.theme-light' | 'window.theme-dark' | 'window.theme-system';
  readonly label: string;
  readonly title: string;
}> = [
  {
    preference: 'light',
    id: 'window.theme-light',
    label: 'Light',
    title: 'Use the light workspace theme',
  },
  {
    preference: 'dark',
    id: 'window.theme-dark',
    label: 'Dark',
    title: 'Use the dark workspace theme',
  },
  {
    preference: 'system',
    id: 'window.theme-system',
    label: 'Match System',
    title: 'Follow the operating system light/dark setting',
  },
];

function themeCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return THEME_CHOICES.map((choice) => ({
    ...enabled(choice.id, 'window', choice.label, choice.title, () =>
      ctx.setAppTheme(choice.preference),
    ),
    active: ctx.appTheme === choice.preference,
  }));
}

export function windowPanelCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  const layers = {
    ...enabled(
      'window.toggle-layers-panel',
      'window',
      'Cuts / Layers Panel',
      'Show or hide the Cuts / Layers panel',
      ctx.toggleLayersPanel,
    ),
    active: ctx.layersPanelOpen,
  };
  const machine = {
    ...enabled(
      'window.toggle-machine-panel',
      'window',
      'Machine Controls Panel',
      'Show or hide the machine controls panel',
      ctx.toggleMachinePanel,
    ),
    active: ctx.machinePanelOpen,
  };
  const toggleSidePanels = enabled(
    'window.toggle-side-panels',
    'window',
    'Toggle Side Panels',
    'Show or hide both side panels',
    ctx.toggleSidePanels,
    'F12',
  );
  const resetLayout = enabled(
    'window.reset-layout',
    'window',
    'Reset Workspace Layout',
    'Restore both side panels to the standard workspace layout',
    ctx.resetWorkspaceLayout,
  );
  return [layers, machine, toggleSidePanels, resetLayout, ...themeCommands(ctx)];
}
