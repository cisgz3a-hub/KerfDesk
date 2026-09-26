// Page choice for Multi-File Trace output (ADR-451): the source image size, or
// the traced artwork plus a margin in millimetres.

import { useState } from 'react';
import { MAX_TRACED_PAGE_MARGIN_MM, type TracedPageFit } from '../../core/trace';

export type TracePageSettings = {
  readonly pageFit: TracedPageFit;
  readonly marginMm: number;
};

export const DEFAULT_TRACE_PAGE_SETTINGS: TracePageSettings = { pageFit: 'image', marginMm: 0 };

/** The batch output's page, or nothing for the default image page. */
export function tracePageOutput(
  settings: TracePageSettings,
): { readonly page?: { readonly fit: 'artwork'; readonly marginMm: number } } {
  return settings.pageFit === 'artwork'
    ? { page: { fit: 'artwork', marginMm: settings.marginMm } }
    : {};
}

function parseMargin(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= MAX_TRACED_PAGE_MARGIN_MM
    ? value
    : null;
}

export function TracePageFields(props: {
  readonly value: TracePageSettings;
  readonly onChange: (patch: Partial<TracePageSettings>) => void;
}): JSX.Element {
  const [marginText, setMarginText] = useState(String(props.value.marginMm));
  return (
    <>
      <label className="lf-field">
        <span>Page</span>
        <select
          className="lf-select"
          aria-label="Page size"
          title="Image size keeps each file in register with its image. Fit to artwork trims the page to the traced shapes."
          value={props.value.pageFit}
          onChange={(event) =>
            props.onChange({
              pageFit: event.currentTarget.value === 'artwork' ? 'artwork' : 'image',
            })
          }
        >
          <option value="image">Image size</option>
          <option value="artwork">Fit to artwork</option>
        </select>
      </label>
      {props.value.pageFit === 'artwork' ? (
        <label className="lf-field">
          <span>Margin (mm)</span>
          <input
            className="lf-input"
            type="number"
            min="0"
            max={MAX_TRACED_PAGE_MARGIN_MM}
            step="any"
            aria-label="Page margin"
            title="Space added around the traced shapes on every side of the page."
            value={marginText}
            onChange={(event) => {
              const text = event.currentTarget.value;
              setMarginText(text);
              const margin = parseMargin(text);
              if (margin !== null) props.onChange({ marginMm: margin });
            }}
          />
        </label>
      ) : null}
    </>
  );
}
