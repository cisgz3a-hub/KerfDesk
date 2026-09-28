// Page choice for Multi-File Trace output (ADR-451): the source image size,
// the traced artwork plus a margin, or a fixed paper page (A4, Letter or a
// custom size) with the artwork centred inside the margins. The margin is one
// value for every side, or four when Per-side margins is ticked.

import {
  MAX_TRACED_PAGE_MARGIN_MM,
  MAX_TRACED_PAPER_SIDE_MM,
  TRACED_PAPER_SIZES_MM,
  type TracedPageLayout,
  type TracedPageMargins,
} from '../../core/trace/traced-page-box';
import { TraceNumberField } from './TraceNumberField';

export type TracePageChoice = 'image' | 'artwork' | 'a4' | 'letter' | 'custom';

export type TracePageSettings = {
  readonly pageFit: TracePageChoice;
  readonly marginMm: number;
  readonly perSideMargins: boolean;
  readonly margins: TracedPageMargins;
  readonly customPaperMm: { readonly width: number; readonly height: number };
};

export const DEFAULT_TRACE_PAGE_SETTINGS: TracePageSettings = {
  pageFit: 'image',
  marginMm: 0,
  perSideMargins: false,
  margins: { top: 0, right: 0, bottom: 0, left: 0 },
  customPaperMm: TRACED_PAPER_SIZES_MM.a4,
};

const PAGE_CHOICES: ReadonlyArray<{ readonly value: TracePageChoice; readonly label: string }> = [
  { value: 'image', label: 'Image size' },
  { value: 'artwork', label: 'Fit to artwork' },
  { value: 'a4', label: 'A4 (210 x 297 mm)' },
  { value: 'letter', label: 'Letter (8.5 x 11 in)' },
  { value: 'custom', label: 'Custom size' },
];

function paperMm(settings: TracePageSettings): { readonly width: number; readonly height: number } {
  if (settings.pageFit === 'a4') return TRACED_PAPER_SIZES_MM.a4;
  if (settings.pageFit === 'letter') return TRACED_PAPER_SIZES_MM.letter;
  return settings.customPaperMm;
}

/** The batch output's page, or nothing for the default image page. */
export function tracePageOutput(settings: TracePageSettings): {
  readonly page?: TracedPageLayout;
} {
  if (settings.pageFit === 'image') return {};
  const margin = settings.perSideMargins
    ? { margins: settings.margins }
    : { marginMm: settings.marginMm };
  if (settings.pageFit === 'artwork') return { page: { fit: 'artwork', ...margin } };
  return { page: { fit: 'paper', paperMm: paperMm(settings), ...margin } };
}

const SIDES: ReadonlyArray<keyof TracedPageMargins> = ['top', 'right', 'bottom', 'left'];

const MARGIN_RANGE = { min: 0, max: MAX_TRACED_PAGE_MARGIN_MM, blankValue: 0, unit: 'mm' };
const PAPER_RANGE = { min: 0, minInclusive: false, max: MAX_TRACED_PAPER_SIDE_MM, unit: 'mm' };

type PageFieldsProps = {
  readonly value: TracePageSettings;
  readonly onChange: (patch: Partial<TracePageSettings>) => void;
};

export function TracePageFields(props: PageFieldsProps): JSX.Element {
  const { value, onChange } = props;
  return (
    <>
      <label className="lf-field">
        <span>Page</span>
        <select
          className="lf-select"
          aria-label="Page size"
          title="Image size keeps each file in register with its image. Fit to artwork trims the page to the traced shapes. A paper size centres the shapes on that page."
          value={value.pageFit}
          onChange={(event) => {
            const chosen = event.currentTarget.value;
            onChange({ pageFit: PAGE_CHOICES.find((c) => c.value === chosen)?.value ?? 'image' });
          }}
        >
          {PAGE_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      {value.pageFit === 'custom' ? <CustomPaperFields value={value} onChange={onChange} /> : null}
      {value.pageFit === 'image' ? null : <TraceMarginFields value={value} onChange={onChange} />}
    </>
  );
}

function CustomPaperFields(props: PageFieldsProps): JSX.Element {
  const paper = props.value.customPaperMm;
  return (
    <>
      <TraceNumberField
        {...PAPER_RANGE}
        label="Page width (mm)"
        ariaLabel="Page width"
        title="Width of the custom page in millimetres."
        value={paper.width}
        onValue={(width) => props.onChange({ customPaperMm: { ...paper, width } })}
      />
      <TraceNumberField
        {...PAPER_RANGE}
        label="Page height (mm)"
        ariaLabel="Page height"
        title="Height of the custom page in millimetres."
        value={paper.height}
        onValue={(height) => props.onChange({ customPaperMm: { ...paper, height } })}
      />
    </>
  );
}

function sideName(side: keyof TracedPageMargins): string {
  return `${side.charAt(0).toUpperCase()}${side.slice(1)}`;
}

// Ticking Per-side margins starts every side at the shared margin, unless
// sides were already set, so the page does not jump when the fields appear.
function perSidePatch(value: TracePageSettings, perSide: boolean): Partial<TracePageSettings> {
  const unset = SIDES.every((side) => value.margins[side] === 0);
  if (!perSide || !unset) return { perSideMargins: perSide };
  const all = value.marginMm;
  return { perSideMargins: true, margins: { top: all, right: all, bottom: all, left: all } };
}

function TraceMarginFields(props: PageFieldsProps): JSX.Element {
  const { value, onChange } = props;
  return (
    <>
      <label className="lf-field">
        <input
          type="checkbox"
          checked={value.perSideMargins}
          title="Set the top, right, bottom and left margins separately."
          onChange={(event) => onChange(perSidePatch(value, event.currentTarget.checked))}
        />
        <span>Per-side margins</span>
      </label>
      {value.perSideMargins ? (
        SIDES.map((side) => (
          <TraceNumberField
            key={side}
            {...MARGIN_RANGE}
            label={`${sideName(side)} margin (mm)`}
            ariaLabel={`${sideName(side)} margin`}
            title={`Space kept clear at the ${side} of the page.`}
            value={value.margins[side]}
            onValue={(mm) => onChange({ margins: { ...value.margins, [side]: mm } })}
          />
        ))
      ) : (
        <TraceNumberField
          {...MARGIN_RANGE}
          label="Margin (mm)"
          ariaLabel="Page margin"
          title="Space kept clear on every side of the page."
          value={value.marginMm}
          onValue={(mm) => onChange({ marginMm: mm })}
        />
      )}
    </>
  );
}
