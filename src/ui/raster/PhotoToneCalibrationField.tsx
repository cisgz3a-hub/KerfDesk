import { photoToneCurvesEqual, type PhotoToneCurve } from '../../core/raster/photo-tone-curve';
import {
  toneCalibrationMismatches,
  useToneCalibrationLibrary,
  type ToneCalibrationRecord,
} from '../calibration/tone-calibration-library';
import { Button } from '../kit';
import type { PhotoEngravingDraft } from './photo-engraving-settings';

const NONE = 'none';
const IN_PROJECT = 'project';

/**
 * ADR-670: choose the material tone calibration the photo burns with. The
 * project stores a copy of the curve, so the list here is only this
 * computer's saved calibrations plus the one the photo already holds.
 */
export function PhotoToneCalibrationField(props: {
  readonly draft: PhotoEngravingDraft;
  readonly power: number;
  readonly speed: number;
  readonly onChange: (patch: Partial<PhotoEngravingDraft>) => void;
  readonly onCalibrate: () => void;
}): JSX.Element {
  const records = useToneCalibrationLibrary((state) => state.records);
  const curve = props.draft.photoToneCurve;
  const chosen = recordFor(records, curve);
  const value = curve === undefined ? NONE : (chosen?.id ?? IN_PROJECT);
  const mismatches =
    chosen === undefined
      ? []
      : toneCalibrationMismatches(chosen.settings, {
          ditherAlgorithm: props.draft.ditherAlgorithm,
          linesPerMm: props.draft.linesPerMm,
          negativeImage: props.draft.negativeImage,
          power: props.power,
          speed: props.speed,
        });
  return (
    <>
      <h3>Material tone calibration</h3>
      <label>
        <span>Tone calibration</span>
        <select
          className="lf-select"
          aria-label="Tone calibration"
          title="Correct photo tones for how this material and these settings darken."
          value={value}
          onChange={(event) => props.onChange({ photoToneCurve: curveFor(event.target.value) })}
        >
          <option value={NONE}>None (burn the tones uncorrected)</option>
          {curve !== undefined && chosen === undefined ? (
            <option value={IN_PROJECT}>{curve.label || 'Calibration'} (in this project)</option>
          ) : null}
          {records.map((record) => (
            <option key={record.id} value={record.id}>
              {record.curve.label}
            </option>
          ))}
        </select>
      </label>
      <p className="lf-photo-engraving__hint">
        {curve === undefined
          ? 'Laser dots are wider than the scan lines, so photos often burn darker than they look. Burn a tone wedge once per material to correct it.'
          : 'Tones are corrected before the dots are placed, so the preview shows fewer dots where this material darkens more.'}
      </p>
      {mismatches.length > 0 ? (
        <p className="lf-photo-engraving__hint" role="status">
          This calibration was measured with a different {mismatches.join(', ')}. Burn a new wedge
          with these settings for true tones.
        </p>
      ) : null}
      <Button
        variant="ghost"
        onClick={props.onCalibrate}
        title="Close this window and burn a tone wedge with these photo settings."
      >
        Calibrate a material…
      </Button>
    </>
  );

  function curveFor(selected: string): PhotoToneCurve | undefined {
    if (selected === NONE) return undefined;
    if (selected === IN_PROJECT) return curve;
    return records.find((record) => record.id === selected)?.curve;
  }
}

function recordFor(
  records: ReadonlyArray<ToneCalibrationRecord>,
  curve: PhotoToneCurve | undefined,
): ToneCalibrationRecord | undefined {
  return curve === undefined
    ? undefined
    : records.find((record) => photoToneCurvesEqual(record.curve, curve));
}
