// Settings → Canvas: snapping and the grid (the same panel as the canvas snap
// popover, LBG-F06), the frame and job start markers (the canvas eye toggle),
// and the arrow-key nudge distances.

import { NumberField } from '../common/NumberField';
import { Button } from '../kit';
import {
  MAX_NUDGE_MM,
  MIN_NUDGE_MM,
  useNudgeStore,
  type NudgeStepKey,
} from '../state/nudge-preferences';
import { useUiStore } from '../state/ui-store';
import { SnapSettingsPanel } from '../workspace/SnapSettingsPopover';
import {
  settingsFieldStyle,
  settingsGroupStyle,
  settingsHeadingStyle,
  settingsNoteStyle,
  settingsRowStyle,
} from './settings-styles';

const NUDGE_FIELDS: ReadonlyArray<{
  readonly key: NudgeStepKey;
  readonly label: string;
  readonly title: string;
}> = [
  {
    key: 'normalMm',
    label: 'Arrow keys',
    title: 'How far one arrow-key press moves the selection or the selected node.',
  },
  {
    key: 'largeMm',
    label: 'Shift+arrow',
    title: 'How far Shift+arrow moves the selection or the selected node.',
  },
  {
    key: 'fineMm',
    label: 'Ctrl+arrow (Cmd on Mac)',
    title: 'How far Ctrl+arrow (Cmd+arrow on a Mac) moves the selection or the selected node.',
  },
];

export function SettingsCanvasSection(): JSX.Element {
  return (
    <>
      <SnappingGroup />
      <StartMarkersGroup />
      <NudgeGroup />
    </>
  );
}

function SnappingGroup(): JSX.Element {
  const enabled = useUiStore((state) => state.snapSettings.enabled);
  const setSnapSettings = useUiStore((state) => state.setSnapSettings);
  const title =
    'Snap while moving, drawing and measuring. The # button on the canvas does the same.';
  return (
    <fieldset style={settingsGroupStyle}>
      <legend style={settingsHeadingStyle}>Snapping and grid</legend>
      <label style={settingsRowStyle} title={title}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setSnapSettings({ enabled: event.target.checked })}
          title={title}
        />
        <span>Snapping on</span>
      </label>
      <SnapSettingsPanel />
    </fieldset>
  );
}

function StartMarkersGroup(): JSX.Element {
  const visible = useUiStore((state) => state.showCanvasStartMarkers);
  const setVisible = useUiStore((state) => state.setShowCanvasStartMarkers);
  const title =
    'Show where Frame and the job start on the canvas. The canvas eye button does the same.';
  return (
    <fieldset style={settingsGroupStyle}>
      <legend style={settingsHeadingStyle}>Canvas markers</legend>
      <label style={settingsRowStyle} title={title}>
        <input
          type="checkbox"
          checked={visible}
          onChange={(event) => setVisible(event.target.checked)}
          title={title}
        />
        <span>Show frame and job start markers</span>
      </label>
    </fieldset>
  );
}

function NudgeGroup(): JSX.Element {
  const steps = useNudgeStore((state) => state.nudgeSteps);
  const setNudgeSteps = useNudgeStore((state) => state.setNudgeSteps);
  const resetNudgeSteps = useNudgeStore((state) => state.resetNudgeSteps);
  return (
    <fieldset style={settingsGroupStyle}>
      <legend style={settingsHeadingStyle}>Nudge distance</legend>
      {NUDGE_FIELDS.map((field) => (
        <label key={field.key} style={settingsFieldStyle} title={field.title}>
          <span>{field.label}</span>
          <NumberField
            ariaLabel={`${field.label} nudge distance in millimetres`}
            title={field.title}
            value={steps[field.key]}
            min={MIN_NUDGE_MM}
            max={MAX_NUDGE_MM}
            step={0.1}
            debounceMs={0}
            onCommit={(value) => setNudgeSteps({ [field.key]: value })}
          />
          <span>mm</span>
        </label>
      ))}
      <p style={settingsNoteStyle}>
        Alt+arrow aligns the selection instead of moving it. Defaults: 1, 10 and 0.1 mm.
      </p>
      <div>
        <Button
          title="Set the three nudge distances back to 1, 10 and 0.1 mm"
          onClick={resetNudgeSteps}
        >
          Reset nudge distances
        </Button>
      </div>
    </fieldset>
  );
}
