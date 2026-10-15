import { useState } from 'react';
import {
  focusTestOptionsIssue,
  focusTestOffsets,
  focusTestProfileIssue,
  generateFocusTest,
  type FocusTestOptions,
} from '../../core/job/focus-test';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { formatGcodeFeedMmPerMin } from '../../core/gcode/feed-word';

const DEFAULTS: FocusTestOptions = {
  steps: 9,
  minOffsetMm: -2,
  maxOffsetMm: 2,
  lineLengthMm: 20,
  spacingMm: 3,
  speed: 1200,
  power: 10,
  travelFeedMmPerMin: 300,
};
const FIELDS: ReadonlyArray<readonly [keyof FocusTestOptions, string]> = [
  ['steps', 'Samples'],
  ['minOffsetMm', 'Minimum Z offset (mm)'],
  ['maxOffsetMm', 'Maximum Z offset (mm)'],
  ['lineLengthMm', 'Line length (mm)'],
  ['spacingMm', 'Sample spacing (mm)'],
  ['speed', 'Cut speed (mm/min)'],
  ['power', 'Power (%)'],
  ['travelFeedMmPerMin', 'Z travel speed (mm/min)'],
];

export function FocusTestDialog(props: { readonly onClose: () => void }): JSX.Element {
  const device = useStore((state) => state.project.device);
  const replaceScene = useStore((state) => state.replaceSceneWithGeneratedScene);
  const [draft, setDraft] = useState(
    () =>
      Object.fromEntries(FIELDS.map(([key]) => [key, String(DEFAULTS[key])])) as Record<
        keyof FocusTestOptions,
        string
      >,
  );
  const options = Object.fromEntries(
    FIELDS.map(([key]) => [key, draft[key].trim() === '' ? Number.NaN : Number(draft[key])]),
  ) as FocusTestOptions;
  const issue = focusTestOptionsIssue(options) ?? focusTestProfileIssue(device);
  return (
    <Dialog
      title="Focus Test"
      onClose={props.onClose}
      size="sm"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (issue !== null) return;
        replaceScene(generateFocusTest(options));
        useToastStore
          .getState()
          .pushToast(
            `Generated ${options.steps} focus samples. Preview, Frame, then review and Start.`,
            'success',
          );
        props.onClose();
      }}
    >
      <p>
        Each line tests one Z offset relative to the starting focus. Positive Z follows your
        controller’s axis direction. Completed samples return to starting Z with the laser off.
      </p>
      <FocusFields draft={draft} onChange={(key, value) => setDraft({ ...draft, [key]: value })} />
      {issue === null ? (
        <p role="status">
          Offsets, first line to last:{' '}
          {focusTestOffsets(options)
            .map((value) => value.toFixed(3))
            .join(', ')}{' '}
          mm. Effective cut / Z feeds:{' '}
          {formatGcodeFeedMmPerMin(Math.min(options.speed, device.maxFeed))} /{' '}
          {formatGcodeFeedMmPerMin(Math.min(options.travelFeedMmPerMin, device.maxFeed))} mm/min.
        </p>
      ) : (
        <p role="alert">{issue}</p>
      )}
      <p>
        Use a controllable Z axis and verify clearance in both directions. Frame checks XY only.
        This does not autofocus or change your origin; interruption can leave Z at a test offset.
        Inspect the narrowest line and set focus manually. Hardware and material results require
        machine testing.
      </p>
      <p>
        Sample labels appear in operation names; they are not engraved. The 2D estimate excludes Z
        travel and the dark returns. Inspect G-code (3D) shows the complete emitted motion and its
        playback estimate.
      </p>
      <DialogActions>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={issue !== null}>
          Generate
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function FocusFields(props: {
  readonly draft: Readonly<Record<keyof FocusTestOptions, string>>;
  readonly onChange: (key: keyof FocusTestOptions, value: string) => void;
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {FIELDS.map(([key, label]) => (
        <label key={key} style={{ display: 'grid', gap: 4 }}>
          {label}
          <input
            type="number"
            step={key === 'steps' ? '1' : 'any'}
            value={props.draft[key]}
            onChange={(event) => props.onChange(key, event.target.value)}
          />
        </label>
      ))}
    </div>
  );
}
