// Settings → General: theme (Window → Appearance), workspace layout (the
// toolbar layout picker), how many recent projects to keep (File → Recent
// Projects), and what autosave does. Each reads and writes the same store as
// its original control.

import { THEME_CHOICES } from '../commands/window-panel-commands';
import { LAYOUT_OPTIONS } from '../common/WorkspaceLayoutSelect';
import { RecentProjectLimitField } from '../recent-projects/RecentProjectLimitField';
import { AUTOSAVE_INTERVAL_MS } from '../state/autosave';
import { useDisplayUnitsStore } from '../state/display-units';
import { useSimpleViewStore } from '../state/simple-view';
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
      <SimpleViewChoice />
      <fieldset style={settingsGroupStyle}>
        <legend style={settingsHeadingStyle}>Recent projects</legend>
        <RecentProjectLimitField />
      </fieldset>
      <section style={settingsGroupStyle}>
        <h3 style={settingsHeadingStyle}>Autosave</h3>
        <p style={settingsNoteStyle}>
          Unsaved work is copied to this computer every {AUTOSAVE_INTERVAL_MS / 1000} seconds and
          offered back the next time KerfDesk starts. It keeps running while a job runs, unless
          copying the project could disturb the job: the status bar then shows{' '}
          <strong>Autosave waiting for job</strong> until the job ends. The interval is fixed.
        </p>
      </section>
    </>
  );
}

// Simple view (ADR-698), the same store as Window → Simple View.
function SimpleViewChoice(): JSX.Element {
  const enabled = useSimpleViewStore((state) => state.enabled);
  const setEnabled = useSimpleViewStore((state) => state.setEnabled);
  const title =
    'Show only power, speed and passes for each laser operation. Any other setting a burn uses stays listed with its value.';
  return (
    <fieldset style={settingsGroupStyle}>
      <legend style={settingsHeadingStyle}>Simple view</legend>
      <label style={settingsRowStyle} title={title}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
          title={title}
        />
        <span>Hide advanced operation settings</span>
      </label>
      <p style={settingsNoteStyle}>
        Changes only what the operation panel shows. Job Review, Pause, Abort and every value stay
        as they are.
      </p>
    </fieldset>
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
