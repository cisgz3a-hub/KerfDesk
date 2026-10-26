import { toneWedgeCommandedPercents } from '../../core/job/tone-calibration-wedge';
import { ditherLabel } from '../layers/DitherSwatchPicker';
import { describeToneSettings, type ToneWedgeRecordTarget } from './tone-calibration-draft';

export type ToneRecordDraft = {
  readonly patchCount: number;
  /** Seen mark strength per patch, 0 (untouched) .. 100 (solid). */
  readonly observed: ReadonlyArray<number>;
  readonly material: string;
};

export function initialToneRecord(patchCount: number): ToneRecordDraft {
  return {
    patchCount,
    observed: toneWedgeCommandedPercents(patchCount).map((value) => Math.round(value)),
    material: '',
  };
}

/** The on-screen grey a mark strength looks like on this material's polarity. */
export function markGrey(percent: number, lightMarks: boolean): string {
  const fraction = Math.max(0, Math.min(100, percent)) / 100;
  const level = Math.round(255 * (lightMarks ? fraction : 1 - fraction));
  return `rgb(${level}, ${level}, ${level})`;
}

export function ToneRecordStep(props: {
  readonly target: ToneWedgeRecordTarget;
  readonly record: ToneRecordDraft;
  /** Functional, so quick successive edits never overwrite each other. */
  readonly onChange: (update: (record: ToneRecordDraft) => ToneRecordDraft) => void;
}): JSX.Element {
  const { target, record, onChange } = props;
  const commanded = toneWedgeCommandedPercents(target.patchCount);
  const light = target.settings.negativeImage;
  const setObserved = (index: number, value: number): void =>
    onChange((current) => ({
      ...current,
      observed: current.observed.map((seen, at) => (at === index ? value : seen)),
    }));
  return (
    <>
      <p className="lf-tone-calibration__intro">
        Look at the burned wedge from arm&apos;s length in good light. For each patch, slide to the
        grey it looks like: 0 is untouched material, 100 is the solid patch.
      </p>
      <p className="lf-tone-calibration__hint">
        Wedge of {target.patchCount} patches burned with{' '}
        {describeToneSettings(target.settings, ditherLabel)}.
      </p>
      <div className="lf-tone-calibration__record">
        <div className="lf-tone-calibration__rows" role="group" aria-label="Recorded wedge patches">
          {commanded.map((asked, index) => (
            <ToneRecordRow
              key={index}
              asked={asked}
              seen={record.observed[index] ?? Math.round(asked)}
              fixed={index === 0 || index === commanded.length - 1}
              light={light}
              onChange={(value) => setObserved(index, value)}
            />
          ))}
        </div>
        <ToneResponseChart commanded={commanded} observed={record.observed} />
      </div>
      <label className="lf-tone-calibration__field lf-tone-calibration__material">
        <span>Material</span>
        <input
          className="lf-input"
          aria-label="Calibrated material"
          title="The material this calibration is for"
          placeholder="For example: Birch plywood 3 mm"
          value={record.material}
          maxLength={60}
          onChange={(event) => {
            const material = event.target.value;
            onChange((current) => ({ ...current, material }));
          }}
        />
      </label>
    </>
  );
}

function ToneRecordRow(props: {
  readonly asked: number;
  readonly seen: number;
  readonly fixed: boolean;
  readonly light: boolean;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  const label = `${Math.round(props.asked)}`;
  // From untouched material to a solid mark, in this material's polarity.
  const ramp = `to right, ${markGrey(0, props.light)}, ${markGrey(100, props.light)}`;
  return (
    <div className="lf-tone-calibration__row">
      <span className="lf-tone-calibration__patch">{label}</span>
      <span
        className="lf-tone-calibration__swatch"
        style={{ background: markGrey(props.asked, props.light) }}
        title="The tone this patch asked for"
      />
      {props.fixed ? (
        <span className="lf-tone-calibration__fixed">
          {props.asked === 0 ? 'Untouched material' : 'Solid'}
        </span>
      ) : (
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={props.seen}
          aria-label={`Patch ${label} looks like`}
          title="Drag to how dark this patch came out"
          className="lf-tone-calibration__slider"
          style={{ background: `linear-gradient(${ramp})` }}
          onChange={(event) => props.onChange(Number(event.target.value))}
        />
      )}
      <span
        className="lf-tone-calibration__swatch"
        style={{ background: markGrey(props.fixed ? props.asked : props.seen, props.light) }}
        title="The tone you saw"
      />
      <output className="lf-tone-calibration__value">
        {props.fixed ? Math.round(props.asked) : props.seen}
      </output>
    </div>
  );
}

const CHART = 120;

function ToneResponseChart(props: {
  readonly commanded: ReadonlyArray<number>;
  readonly observed: ReadonlyArray<number>;
}): JSX.Element {
  const last = props.commanded.length - 1;
  const points = props.commanded
    .map((asked, index) => {
      const seen = index === 0 ? 0 : index === last ? 100 : (props.observed[index] ?? asked);
      return `${(asked / 100) * CHART},${CHART - (seen / 100) * CHART}`;
    })
    .join(' ');
  return (
    <figure className="lf-tone-calibration__chart">
      <svg
        viewBox={`-4 -4 ${CHART + 8} ${CHART + 8}`}
        role="img"
        aria-label="Recorded tone response: asked across, seen up"
      >
        <rect x={0} y={0} width={CHART} height={CHART} className="lf-tone-calibration__frame" />
        <line x1={0} y1={CHART} x2={CHART} y2={0} className="lf-tone-calibration__diagonal" />
        <polyline points={points} className="lf-tone-calibration__response" />
      </svg>
      <figcaption>
        Above the diagonal burns darker than asked; the calibration lightens those tones.
      </figcaption>
    </figure>
  );
}
