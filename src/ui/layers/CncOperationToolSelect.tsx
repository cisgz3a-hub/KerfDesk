import type { CncTool } from '../../core/scene';
import { CncToolOptions } from '../machine/CncToolOptions';
import { CncToolPicture } from '../machine/CncToolPicture';

export function CncOperationToolSelect(props: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: string | null;
  readonly emptyLabel: string;
  readonly tools: ReadonlyArray<CncTool>;
  readonly allTools: ReadonlyArray<CncTool>;
  readonly defaultTool?: CncTool | undefined;
  readonly onChange: (toolId: string | null) => void;
}): JSX.Element {
  const selected =
    props.value === null
      ? props.defaultTool
      : props.allTools.find((tool) => tool.id === props.value);
  const outsideChoices =
    props.value !== null && !props.tools.some((tool) => tool.id === props.value);
  return (
    <div className="lf-cnc-tool-field">
      <label>
        <span>{props.label}</span>
        <select
          value={props.value ?? ''}
          aria-label={props.ariaLabel}
          title={`Choose ${props.label.toLowerCase()} for this operation.`}
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
      </label>
      {selected === undefined ? null : (
        <>
          <p className="lf-cnc-settings-hint">{selected.name}</p>
          <CncToolPicture key={selected.id} tool={selected} />
        </>
      )}
    </div>
  );
}
