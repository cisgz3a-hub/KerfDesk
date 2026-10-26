// Settings → General: theme (Window → Appearance), workspace layout (the
// toolbar layout picker), how many recent projects to keep (File → Recent
// Projects), and what autosave does. Each reads and writes the same store as
// its original control.

import { THEME_CHOICES } from '../commands/window-panel-commands';
import { LAYOUT_OPTIONS } from '../common/WorkspaceLayoutSelect';
import { RecentProjectLimitField } from '../recent-projects/RecentProjectLimitField';
import { AUTOSAVE_INTERVAL_MS } from '../state/autosave';
import { useDisplayUnitsStore } from '../state/display-units';
import type { DisplayLengthUnit } from '../display-length';
import { useWorkspaceLayoutStore } from '../state/workspace-layout-store';
import { setAppThemePreference } from '../theme/app-theme';
import { useAppThemePreference } from '../theme/use-app-theme';
import {
  settingsGroupStyle,
  settingsHeadingStyle,
  settingsNoteStyle,
  settingsRowStyle,
} from './settings-styles';

export function SettingsGeneralSection(): JSX.Element {
  return (
    <>
      <ThemeChoice />
      <UnitsChoice />
      <LayoutChoice />
      <fieldset style={settingsGroupStyle}>
        <legend style={settingsHeadingStyle}>Recent projects</legend>
        <RecentProjectLimitField />
      </fieldset>
      <section style={settingsGroupStyle}>
        <h3 style={settingsHeadingStyle}>Autosave</h3>
        <p style={settingsNoteStyle}>
          Unsaved work is copied to this computer every {AUTOSAVE_INTERVAL_MS / 1000} seconds,
          except while a job is running, and offered back the next time KerfDesk starts. The
          interval is fixed.
        </p>
      </section>
    </>
  );
}

function ThemeChoice(): JSX.Element {
  const theme = useAppThemePreference();
  return (
    <fieldset style={settingsGroupStyle}>
      <legend style={settingsHeadingStyle}>Theme</legend>
      {THEME_CHOICES.map((choice) => (
        <label key={choice.preference} style={settingsRowStyle} title={choice.title}>
          <input
            type="radio"
            name="settings-theme"
            checked={theme === choice.preference}
            onChange={() => setAppThemePreference(choice.preference)}
            title={choice.title}
          />
          <span>{choice.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

const UNIT_CHOICES: ReadonlyArray<{
  readonly unit: DisplayLengthUnit;
  readonly label: string;
  readonly title: string;
}> = [
  {
    unit: 'mm',
    label: 'Millimetres (mm, mm/min)',
    title: 'Show lengths in millimetres and feeds in millimetres per minute.',
  },
  {
    unit: 'in',
    label: 'Inches (in, in/min)',
    title: 'Show lengths in inches and feeds in inches per minute.',
  },
];

// Display units (ADR-629): only what the screen shows and accepts. Projects,
// machine settings and G-code stay in millimetres.
function UnitsChoice(): JSX.Element {
  const unit = useDisplayUnitsStore((state) => state.lengthUnit);
  const setUnit = useDisplayUnitsStore((state) => state.setLengthUnit);
  return (
    <fieldset style={settingsGroupStyle}>
      <legend style={settingsHeadingStyle}>Units</legend>
      {UNIT_CHOICES.map((choice) => (
        <label key={choice.unit} style={settingsRowStyle} title={choice.title}>
          <input
            type="radio"
            name="settings-display-units"
            checked={unit === choice.unit}
            onChange={() => setUnit(choice.unit)}
            title={choice.title}
          />
          <span>{choice.label}</span>
        </label>
      ))}
      <p style={settingsNoteStyle}>
        Changes what the selection boxes, rulers, status bar, measurements, machine position, jog
        step, laser speed and CNC depth and feed show. Other boxes keep their own mm label. Type a
        unit, like 10mm or 1in, to enter it in any box that takes one. Projects and G-code stay in
        millimetres.
      </p>
    </fieldset>
  );
}

function LayoutChoice(): JSX.Element {
  const preference = useWorkspaceLayoutStore((state) => state.preference);
  const setPreference = useWorkspaceLayoutStore((state) => state.setPreference);
  return (
    <fieldset style={settingsGroupStyle}>
      <legend style={settingsHeadingStyle}>Workspace layout</legend>
      {LAYOUT_OPTIONS.map((option) => (
        <label key={option.value} style={settingsRowStyle} title={option.title}>
          <input
            type="radio"
            name="settings-workspace-layout"
            checked={preference === option.value}
            onChange={() => setPreference(option.value)}
            title={option.title}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
