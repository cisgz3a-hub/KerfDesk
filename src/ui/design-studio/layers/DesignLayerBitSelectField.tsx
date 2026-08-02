import type { CncTool } from '../../../core/scene';
import { cncToolGeometryLabel } from '../../common/cnc-tool-geometry-label';
import { CncToolOptions } from '../../machine/CncToolOptions';
import {
  DESIGN_FIELD_INPUT_STYLE,
  DESIGN_FIELD_LABEL_STYLE,
  DESIGN_FIELD_STYLE,
} from './design-layer-settings-styles';

const ACTIVE_BIT_VALUE = '';

/** Selects a primary or clearing bit while preserving unavailable saved values. */
export function DesignLayerBitSelectField(props: {
  readonly label: string;
  readonly title: string;
  readonly value: string | undefined;
  readonly emptyLabel: string;
  readonly tools: ReadonlyArray<CncTool>;
  readonly currentTool: CncTool | undefined;
  readonly unavailablePrefix: string;
  readonly onSelect: (toolId: string | null) => void;
}): JSX.Element {
  const unavailableValue =
    props.value !== undefined && !props.tools.some((tool) => tool.id === props.value)
      ? props.value
      : null;
  return (
    <label style={DESIGN_FIELD_STYLE}>
      <span style={DESIGN_FIELD_LABEL_STYLE}>{props.label}</span>
      <select
        value={props.value ?? ACTIVE_BIT_VALUE}
        title={props.title}
        onChange={(event) =>
          props.onSelect(event.target.value === ACTIVE_BIT_VALUE ? null : event.target.value)
        }
        style={DESIGN_FIELD_INPUT_STYLE}
      >
        <option value={ACTIVE_BIT_VALUE}>{props.emptyLabel}</option>
        {unavailableValue === null ? null : (
          <option value={unavailableValue} disabled>
            {unavailableCurrentToolLabel(
              unavailableValue,
              props.currentTool,
              props.unavailablePrefix,
            )}
          </option>
        )}
        <CncToolOptions tools={props.tools} />
      </select>
    </label>
  );
}

function unavailableCurrentToolLabel(
  toolId: string,
  tool: CncTool | undefined,
  prefix: string,
): string {
  return tool === undefined
    ? `${prefix} — missing ${toolId}`
    : `${prefix} — ${cncToolGeometryLabel(tool)} — ${tool.name}`;
}
