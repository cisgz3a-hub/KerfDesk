import { formatGcodeFeedMmPerMin } from '../../core/gcode/feed-word';
import { formatUpTo2Decimals } from '../../core/util/number-format';
import { ditherLabel } from '../layers/DitherSwatchPicker';
import type { PhotoTestCardRecord } from './photo-test-card-draft';
import { PHOTO_TEST_MATERIAL_MAX_LENGTH, type PhotoTestProcessing } from './photo-test-library';
import { formatDpi } from './tone-calibration-draft';

/** The square the operator picked on the burned card, and the material's name. */
export type PhotoTestPick = {
  readonly row: number | null;
  readonly column: number | null;
  readonly material: string;
};

export const EMPTY_PHOTO_TEST_PICK: PhotoTestPick = { row: null, column: null, material: '' };

/** "Blue Noise · 254 DPI · light marks" */
export function describeProcessing(processing: PhotoTestProcessing): string {
  return [
    ditherLabel(processing.ditherAlgorithm),
    `${formatDpi(processing.linesPerMm)} DPI`,
    processing.negativeImage ? 'light marks' : 'dark marks',
  ].join(' · ');
}

export function PhotoTestPickStep(props: {
  readonly card: PhotoTestCardRecord | null;
  readonly pick: PhotoTestPick;
  readonly onChange: (patch: Partial<PhotoTestPick>) => void;
}): JSX.Element {
  const { card, pick } = props;
  if (card === null)
    return (
      <p className="lf-tone-calibration__intro">
        No test card has been generated on this computer yet. Make one in step 1, burn it, then come
        back here.
      </p>
    );
  return (
    <>
      <p className="lf-tone-calibration__intro">
        Look at the burned card in good light. Click the square where the face looks best: clear
        eyes, clean highlights, and shadows that still hold detail.
      </p>
      <p className="lf-tone-calibration__hint">
        Card cut from <strong>{card.sourceName}</strong>, burned with{' '}
        {describeProcessing(card.processing)}. Power runs across, speed runs down, as on the card.
      </p>
      <PickGrid card={card} pick={pick} onChange={props.onChange} />
      <EdgeHint card={card} pick={pick} />
      <label className="lf-tone-calibration__field lf-tone-calibration__material">
        <span>Material</span>
        <input
          className="lf-input"
          aria-label="Tested material"
          title="Name the material this power and speed are for"
          placeholder="For example: Black slate coaster"
          value={pick.material}
          maxLength={PHOTO_TEST_MATERIAL_MAX_LENGTH}
          onChange={(event) => props.onChange({ material: event.target.value })}
        />
      </label>
    </>
  );
}

function PickGrid(props: {
  readonly card: PhotoTestCardRecord;
  readonly pick: PhotoTestPick;
  readonly onChange: (patch: Partial<PhotoTestPick>) => void;
}): JSX.Element {
  const { card } = props;
  return (
    <div
      className="lf-photo-test-card__grid"
      role="radiogroup"
      aria-label="Burned squares"
      style={{ gridTemplateColumns: `auto repeat(${card.powers.length}, minmax(0, 1fr))` }}
    >
      <span aria-hidden="true" />
      {card.powers.map((power, column) => (
        <span key={column} className="lf-photo-test-card__heading">
          {formatUpTo2Decimals(power)}%
        </span>
      ))}
      {card.speeds.map((speed, row) => (
        <PickRow key={row} {...props} row={row} speed={speed} />
      ))}
    </div>
  );
}

function PickRow(props: {
  readonly card: PhotoTestCardRecord;
  readonly pick: PhotoTestPick;
  readonly row: number;
  readonly speed: number;
  readonly onChange: (patch: Partial<PhotoTestPick>) => void;
}): JSX.Element {
  const { pick, row } = props;
  const speedText = formatGcodeFeedMmPerMin(props.speed);
  return (
    <>
      <span className="lf-photo-test-card__heading">{speedText} mm/min</span>
      {props.card.powers.map((power, column) => {
        const checked = pick.row === row && pick.column === column;
        return (
          <label
            key={column}
            className={`lf-photo-test-card__square${checked ? ' is-picked' : ''}`}
            title="Pick this square as the best burn"
          >
            <input
              type="radio"
              name="photo-test-square"
              aria-label={`${formatUpTo2Decimals(power)}% power at ${speedText} mm/min`}
              checked={checked}
              onChange={() => props.onChange({ row, column })}
            />
          </label>
        );
      })}
    </>
  );
}

/** A pick on the card's edge may not be the best there is: say which way to look. */
export function photoTestEdgeHints(card: PhotoTestCardRecord, pick: PhotoTestPick): string[] {
  const out: string[] = [];
  const lastColumn = card.powers.length - 1;
  const lastRow = card.speeds.length - 1;
  if (pick.column !== null && lastColumn > 0) {
    if (pick.column === 0) out.push('lower power');
    if (pick.column === lastColumn && (card.powers[lastColumn] ?? 100) < 100)
      out.push('higher power');
  }
  if (pick.row !== null && lastRow > 0) {
    if (pick.row === 0) out.push('faster speeds');
    if (pick.row === lastRow) out.push('slower speeds');
  }
  return out;
}

function EdgeHint(props: {
  readonly card: PhotoTestCardRecord;
  readonly pick: PhotoTestPick;
}): JSX.Element | null {
  const hints = photoTestEdgeHints(props.card, props.pick);
  if (hints.length === 0) return null;
  return (
    <p className="lf-tone-calibration__hint" role="status">
      This square is on the edge of the card, so a better burn may lie beyond it. To check, burn
      another card with {hints.join(' and ')}.
    </p>
  );
}
