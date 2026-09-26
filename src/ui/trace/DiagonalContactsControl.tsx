// Diagonal contacts (ADR-450): the operator's handle on TraceOptions.turnPolicy
// (ADR-403), the choice LightBurn and Potrace call the turn policy. Where two
// ink pixels touch only at a corner (a checkerboard contact), a bitmap cannot
// say whether the ink or the paper passes through that corner.

import { useId } from 'react';
import type { TraceOptions } from '../../core/trace';
import type { LightBurnTraceSettingOverrides } from './trace-options';

export type DiagonalContactsPolicy = NonNullable<TraceOptions['turnPolicy']>;

export const DIAGONAL_CONTACTS_CHOICES: ReadonlyArray<{
  readonly value: DiagonalContactsPolicy;
  readonly label: string;
}> = [
  { value: 'auto', label: 'Auto' },
  { value: 'connect-ink', label: 'Join ink' },
  { value: 'connect-paper', label: 'Split ink' },
];

export const DIAGONAL_CONTACTS_HELP =
  'Where two ink pixels touch only at a corner, like squares on a checkerboard. ' +
  'Auto keeps thin diagonal lines joined and thin gaps in solid ink open. ' +
  'Join ink always connects the two pixels, so shapes that touch at a corner trace as one. ' +
  'Split ink always separates them, so a one-pixel diagonal line can break into dots.';

/** Only the filled-contour lane resolves corner contacts; Centerline and Edge
 *  Detection ignore the policy, so they do not offer the control. */
export function offersDiagonalContacts(preset: TraceOptions): boolean {
  return (
    preset.photoDetail === undefined &&
    preset.colourLayers === undefined &&
    (preset.traceMode ?? 'filled-contours') === 'filled-contours'
  );
}

export function DiagonalContactsControl(props: {
  readonly preset: TraceOptions;
  readonly overrides: LightBurnTraceSettingOverrides;
  readonly onChange: (next: LightBurnTraceSettingOverrides) => void;
}): JSX.Element | null {
  const selectId = useId();
  const hintId = useId();
  if (!offersDiagonalContacts(props.preset)) return null;
  const value = props.overrides.turnPolicy ?? props.preset.turnPolicy ?? 'auto';
  return (
    <div className="lf-trace-number">
      <label htmlFor={selectId}>
        <span>Diagonal contacts</span>
        <select
          id={selectId}
          className="lf-select"
          aria-label="Trace diagonal contacts"
          aria-describedby={hintId}
          title={DIAGONAL_CONTACTS_HELP}
          value={value}
          onChange={(event) =>
            props.onChange({
              ...props.overrides,
              turnPolicy: parseDiagonalContactsPolicy(event.target.value),
            })
          }
        >
          {DIAGONAL_CONTACTS_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <p id={hintId}>{DIAGONAL_CONTACTS_HELP}</p>
    </div>
  );
}

function parseDiagonalContactsPolicy(value: string): DiagonalContactsPolicy {
  return value === 'connect-ink' || value === 'connect-paper' ? value : 'auto';
}
