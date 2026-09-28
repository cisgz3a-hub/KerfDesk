// ADR-495: the Automatic switch beside an Image's or a Fill's Overscan, and the
// runway it will run. The hidden field tells the form reader the switch was
// shown, since an unchecked box sends nothing (cut-settings-draft.ts).

import type { DeviceProfile } from '../../core/devices';
import { automaticOverscanMm, scanFeedMmPerMin } from '../../core/job/automatic-overscan';

export function AutoOverscanSwitch(props: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label className="lf-field">
      <span className="lf-field-label lf-field-label--md">Automatic</span>
      <span style={controlStyle}>
        <input
          type="hidden"
          name="autoOverscanShown"
          value="on"
          title="Hidden marker that the Automatic overscan switch was shown, used when saving cut settings."
        />
        <input
          name="autoOverscan"
          type="checkbox"
          className="lf-checkbox"
          checked={props.checked}
          onChange={(event) => props.onChange(event.currentTarget.checked)}
          aria-label="Cut settings automatic overscan"
          title="Work the overscan out from this operation's speed and the machine's acceleration along the scan direction, each time the job is prepared."
        />
      </span>
    </label>
  );
}

/** What Automatic runs for this operation now, in words. */
export function automaticOverscanNote(input: {
  readonly speed: number;
  readonly scanAngleDeg: number;
  readonly device: Pick<DeviceProfile, 'maxFeed' | 'accelMmPerSec2'>;
  readonly maxMm: number;
}): string {
  const feed = scanFeedMmPerMin({ speed: input.speed }, input.device);
  const runwayMm = automaticOverscanMm({
    feedMmPerMin: feed,
    accelMmPerSec2: input.device.accelMmPerSec2,
    scanAngleDeg: input.scanAngleDeg,
    maxMm: input.maxMm,
  });
  const capped = runwayMm >= input.maxMm ? `, held at the ${input.maxMm} mm maximum` : '';
  return (
    `Automatic runs ${formatNumber(runwayMm)} mm${capped}: the run-up from rest at ` +
    `${formatNumber(feed)} mm/min with ${formatNumber(input.device.accelMmPerSec2)} mm/s² ` +
    `acceleration along a ${formatNumber(input.scanAngleDeg)}° scan, plus 10%. It follows the ` +
    'speed, the angle and Machine Setup whenever the job is prepared. If the machine acceleration ' +
    'was not read from the controller, check the scan edges on scrap.'
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

const controlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
