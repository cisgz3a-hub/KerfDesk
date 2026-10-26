import type { ChangeEvent } from 'react';
import { ditherLabel } from '../layers/DitherSwatchPicker';
import { calibrationGridStyle } from './calibration-dialog-styles';
import { CalibrationNumberField } from './CalibrationNumberField';
import {
  describeToneSettings,
  toneWedgeDithers,
  type ToneCalibrationSeed,
  type ToneWedgeDraft,
} from './tone-calibration-draft';

type NumberKey = 'patchCount' | 'patchSizeMm' | 'gapMm' | 'dpi' | 'power' | 'speed';

const NUMBER_FIELDS: ReadonlyArray<{
  readonly key: NumberKey;
  readonly label: string;
  readonly min: number;
  readonly max: number | undefined;
  readonly step: number | 'any';
}> = [
  { key: 'patchCount', label: 'Patches', min: 6, max: 21, step: 1 },
  { key: 'patchSizeMm', label: 'Patch size (mm)', min: 3, max: 50, step: 'any' },
  { key: 'gapMm', label: 'Gap (mm)', min: 0, max: 10, step: 'any' },
  { key: 'dpi', label: 'DPI', min: 25, max: 2540, step: 'any' },
  { key: 'power', label: 'Power (%)', min: 0, max: 100, step: 'any' },
  { key: 'speed', label: 'Speed (mm/min)', min: 1, max: undefined, step: 'any' },
];

export function ToneWedgeStep(props: {
  readonly draft: ToneWedgeDraft;
  readonly seed: ToneCalibrationSeed | null;
  readonly onChange: (patch: Partial<ToneWedgeDraft>) => void;
}): JSX.Element {
  const { draft, seed, onChange } = props;
  const text =
    (key: keyof ToneWedgeDraft) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void =>
      onChange({ [key]: event.target.value });
  return (
    <>
      <p className="lf-tone-calibration__intro">
        Every material and DPI darkens differently, and laser dots are wider than the scan lines, so
        photos often burn too dark. Burn this grey step wedge on a scrap of the same material with
        your photo&apos;s settings, then record what you see.
      </p>
      <SeedHint seed={seed} />
      <div style={calibrationGridStyle}>
        <label className="lf-tone-calibration__field">
          <span>Photo processing</span>
          <select
            className="lf-select"
            aria-label="Wedge photo processing"
            title="The photo processing the wedge is burned with"
            value={draft.ditherAlgorithm}
            onChange={text('ditherAlgorithm')}
          >
            {toneWedgeDithers(seed).map((algorithm) => (
              <option key={algorithm} value={algorithm}>
                {ditherLabel(algorithm)}
              </option>
            ))}
          </select>
        </label>
        <label className="lf-tone-calibration__field">
          <span>Material marking</span>
          <select
            className="lf-select"
            aria-label="Wedge material marking"
            title="Whether the laser darkens or lightens this material"
            value={draft.marking}
            onChange={text('marking')}
          >
            <option value="dark">Dark marks on a light surface</option>
            <option value="light">Light marks on a dark surface</option>
          </select>
        </label>
        {NUMBER_FIELDS.map((field) => (
          <CalibrationNumberField
            key={field.key}
            label={field.label}
            value={draft[field.key]}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={text(field.key)}
          />
        ))}
      </div>
      <p className="lf-tone-calibration__hint">
        Generate replaces the current project with the wedge (you are asked to save first). Frame
        and Start it as usual, then reopen Tone Calibration and choose Record.
      </p>
    </>
  );
}

function SeedHint({ seed }: { readonly seed: ToneCalibrationSeed | null }): JSX.Element {
  if (seed === null)
    return (
      <p className="lf-tone-calibration__hint">
        Tip: select the photo first and its operation settings fill in here.
      </p>
    );
  const { settings } = seed;
  return (
    <p className="lf-tone-calibration__hint">
      Settings from <strong>{seed.sourceName}</strong>:{' '}
      {describeToneSettings(
        {
          ditherAlgorithm: settings.ditherAlgorithm,
          linesPerMm: settings.linesPerMm,
          power: settings.power,
          speed: settings.speed,
          negativeImage: settings.negativeImage,
        },
        ditherLabel,
      )}
      . Its other image settings (passes, scan direction, dot width) burn the wedge too.
    </p>
  );
}
