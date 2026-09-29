// The Size row of Multi-File Trace (rank 33): each file's own size (its
// embedded density, or the default bitmap DPI, as Import Image sizes it), one
// DPI for every file, or one width in millimetres with the height following
// each file's aspect ratio.

import type { MultiFileTraceSize } from './multi-file-trace-size';
import { TraceNumberField } from './TraceNumberField';

export type TraceSizeMode = 'file' | 'dpi' | 'width';

export type TraceSizeSettings = {
  readonly sizeMode: TraceSizeMode;
  readonly sizeDpi: number;
  readonly sizeWidthMm: number;
};

export const DEFAULT_TRACE_SIZE_SETTINGS: TraceSizeSettings = {
  sizeMode: 'file',
  sizeDpi: 300,
  sizeWidthMm: 100,
};

const MAX_TRACE_DPI = 100000;
const MAX_TRACE_WIDTH_MM = 10000;

/** The batch's size override, or nothing for each file's own size. */
export function traceSizeOutput(settings: TraceSizeSettings): {
  readonly size?: MultiFileTraceSize;
} {
  if (settings.sizeMode === 'dpi') return { size: { kind: 'dpi', dpi: settings.sizeDpi } };
  if (settings.sizeMode === 'width') {
    return { size: { kind: 'width', widthMm: settings.sizeWidthMm } };
  }
  return {};
}

const SIZE_CHOICES: ReadonlyArray<{ readonly value: TraceSizeMode; readonly label: string }> = [
  { value: 'file', label: 'From file' },
  { value: 'dpi', label: 'DPI' },
  { value: 'width', label: 'Width (mm)' },
];

export function TraceSizeFields(props: {
  readonly value: TraceSizeSettings;
  readonly onChange: (patch: Partial<TraceSizeSettings>) => void;
}): JSX.Element {
  const { value, onChange } = props;
  return (
    <>
      <label className="lf-field">
        <span>Size</span>
        <select
          className="lf-select"
          aria-label="Output size"
          title="From file uses each image's embedded DPI (or the default bitmap DPI). DPI or Width gives every file that size."
          value={value.sizeMode}
          onChange={(event) => {
            const chosen = event.currentTarget.value;
            onChange({ sizeMode: SIZE_CHOICES.find((c) => c.value === chosen)?.value ?? 'file' });
          }}
        >
          {SIZE_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      {value.sizeMode === 'dpi' ? (
        <TraceNumberField
          label="DPI"
          ariaLabel="Output DPI"
          title="Pixels per inch for every image; the millimetre size is its pixel size at this DPI."
          value={value.sizeDpi}
          min={0}
          minInclusive={false}
          max={MAX_TRACE_DPI}
          unit="DPI"
          onValue={(dpi) => onChange({ sizeDpi: dpi })}
        />
      ) : null}
      {value.sizeMode === 'width' ? (
        <TraceNumberField
          label="Width (mm)"
          ariaLabel="Output width"
          title="Width of every traced image in millimetres; the height keeps each image's proportions."
          value={value.sizeWidthMm}
          min={0}
          minInclusive={false}
          max={MAX_TRACE_WIDTH_MM}
          unit="mm"
          onValue={(widthMm) => onChange({ sizeWidthMm: widthMm })}
        />
      ) : null}
    </>
  );
}
