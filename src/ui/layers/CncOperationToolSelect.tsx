import { useId } from 'react';
import type { CncTool } from '../../core/scene';
import { CncToolOptions } from '../machine/CncToolOptions';

export function CncOperationToolSelect(props: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: string | null;
  readonly emptyLabel: string;
  readonly tools: ReadonlyArray<CncTool>;
  readonly allTools: ReadonlyArray<CncTool>;
  readonly defaultTool?: CncTool | undefined;
  /** What the choice does; the chosen bit's full name is added, since the box can cut it off. */
  readonly description: string;
  /** Shown under the box only while a bit is chosen. */
  readonly hint?: string;
  /** A quiet action beside the label, such as Manage bits. */
  readonly action?: React.ReactNode;
  readonly onChange: (toolId: string | null) => void;
}): JSX.Element {
  const selected =
    props.value === null
      ? props.defaultTool
      : props.allTools.find((tool) => tool.id === props.value);
  const outsideChoices =
    props.value !== null && !props.tools.some((tool) => tool.id === props.value);
  const id = useId();
  return (
    <div className="lf-cnc-tool-field">
      <div className="lf-cnc-tool-field__label">
        <label htmlFor={id}>{props.label}</label>
        {props.action}
      </div>
      <select
        id={id}
        value={props.value ?? ''}
        aria-label={props.ariaLabel}
        title={
          selected === undefined
            ? props.description
            : `${props.description} Current: ${selected.name}.`
        }
        onChange={(event) => props.onChange(event.target.value || null)}
      >
        <option value="">{props.emptyLabel}</option>
        {outsideChoices ? (
          <option value={props.value ?? ''}>
            {selected === undefined
              ? `Unavailable bit (${props.value})`
              : `Saved: ${selected.name}`}
          </option>
        ) : null}
        <CncToolOptions tools={props.tools} />
      </select>
      {props.value !== null && props.hint !== undefined ? (
        <p className="lf-cnc-settings-hint" role="note">
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}
