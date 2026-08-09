import type { CncMachineConfig, CncTool, Layer } from '../../../core/scene';
import { CncMaterialOptions } from '../../common/CncMaterialOptions';
import { MANUAL_FEEDS_LABEL } from '../../common/cnc-material-vocabulary';
import { CncToolOptions } from '../../machine/CncToolOptions';
import type { CncStartupOperationDraft } from '../../state/cnc-startup-setup';

const JOB_MATERIAL_VALUE = '__job-material__';

export function DeviceSetupCncToolPlan(props: {
  readonly machine: CncMachineConfig;
  readonly layers: ReadonlyArray<Layer>;
  readonly drafts: ReadonlyArray<CncStartupOperationDraft>;
  readonly onChange: (draft: CncStartupOperationDraft) => void;
}): JSX.Element {
  if (props.layers.length === 0) {
    return (
      <p style={emptyStyle}>
        No artwork operations yet. New artwork will use the current job material and default bit.
      </p>
    );
  }
  const layerById = new Map(props.layers.map((layer) => [layer.id, layer]));
  return (
    <div style={planStyle}>
      {props.drafts.map((draft) => {
        const layer = layerById.get(draft.layerId);
        return layer === undefined ? null : (
          <OperationToolPlan
            key={draft.layerId}
            machine={props.machine}
            layer={layer}
            draft={draft}
            onChange={props.onChange}
          />
        );
      })}
    </div>
  );
}

function OperationToolPlan(props: {
  readonly machine: CncMachineConfig;
  readonly layer: Layer;
  readonly draft: CncStartupOperationDraft;
  readonly onChange: (draft: CncStartupOperationDraft) => void;
}): JSX.Element {
  const edit = (patch: Partial<CncStartupOperationDraft>): void =>
    props.onChange({ ...props.draft, ...patch });
  const primaryId = props.draft.toolId ?? props.machine.toolId;
  const primary = props.machine.tools.find((tool) => tool.id === primaryId);
  const flatTools = props.machine.tools.filter((tool) => tool.kind === 'end-mill');
  const roughers = flatTools.filter(
    (tool) => primary !== undefined && tool.diameterMm > primary.diameterMm,
  );
  return (
    <details style={operationStyle}>
      <summary style={summaryStyle} title={`Show Startup assignments for ${props.layer.name}.`}>
        <span style={{ ...swatchStyle, background: props.layer.color }} />
        <strong>{props.layer.name}</strong>
        <span style={summaryDetailStyle}>{operationSummary(props.machine, props.draft)}</span>
      </summary>
      <div style={operationFieldsStyle}>
        <label style={fieldStyle}>
          <span>Material</span>
          <select
            value={materialSelectValue(props.machine, props.draft.materialKey)}
            onChange={(event) =>
              edit({ materialKey: materialKeyFromSelect(props.machine, event.target.value) })
            }
            aria-label={`Startup material for ${props.layer.name}`}
            title="Choose this operation's material override, job material, or manual values."
          >
            <option value={JOB_MATERIAL_VALUE}>{jobMaterialLabel(props.machine)}</option>
            <option value="">{MANUAL_FEEDS_LABEL} for this operation</option>
            <CncMaterialOptions />
          </select>
        </label>
        <ToolSelect
          label="Primary bit"
          ariaLabel={`Startup bit for ${props.layer.name}`}
          value={props.draft.toolId}
          emptyLabel="Use job default bit"
          tools={props.machine.tools}
          onChange={(toolId) => edit({ toolId })}
        />
        <ToolSelect
          label="V-carve floor clearing"
          ariaLabel={`Startup floor clearing bit for ${props.layer.name}`}
          value={props.draft.vClearToolId}
          emptyLabel="Single stage"
          tools={flatTools}
          onChange={(vClearToolId) => edit({ vClearToolId })}
        />
        <ToolSelect
          label="Pocket roughing"
          ariaLabel={`Startup pocket roughing bit for ${props.layer.name}`}
          value={props.draft.pocketRoughToolId}
          emptyLabel="Single bit"
          tools={roughers}
          onChange={(pocketRoughToolId) => edit({ pocketRoughToolId })}
        />
        <ToolSelect
          label="Relief finishing"
          ariaLabel={`Startup relief finishing bit for ${props.layer.name}`}
          value={props.draft.reliefFinishToolId}
          emptyLabel="Roughing only"
          tools={props.machine.tools}
          onChange={(reliefFinishToolId) => edit({ reliefFinishToolId })}
        />
      </div>
    </details>
  );
}

function ToolSelect(props: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: string | null;
  readonly emptyLabel: string;
  readonly tools: ReadonlyArray<CncTool>;
  readonly onChange: (toolId: string | null) => void;
}): JSX.Element {
  const isMissing =
    props.value !== null && !props.tools.some((candidate) => candidate.id === props.value);
  return (
    <label style={fieldStyle}>
      <span>{props.label}</span>
      <select
        value={props.value ?? ''}
        onChange={(event) => props.onChange(event.target.value === '' ? null : event.target.value)}
        aria-label={props.ariaLabel}
        title={`Choose ${props.label.toLowerCase()} for this operation in Startup Setup.`}
      >
        <option value="">{props.emptyLabel}</option>
        {isMissing ? <option value={props.value ?? ''}>Current unavailable bit</option> : null}
        <CncToolOptions tools={props.tools} />
      </select>
    </label>
  );
}

function materialSelectValue(machine: CncMachineConfig, materialKey: string | null): string {
  const jobMaterial = machine.stock.materialKey ?? null;
  return materialKey === jobMaterial ? JOB_MATERIAL_VALUE : (materialKey ?? '');
}

function materialKeyFromSelect(machine: CncMachineConfig, value: string): string | null {
  if (value === JOB_MATERIAL_VALUE) return machine.stock.materialKey ?? null;
  return value === '' ? null : value;
}

function jobMaterialLabel(machine: CncMachineConfig): string {
  return machine.stock.materialKey === undefined
    ? `Use job default (${MANUAL_FEEDS_LABEL})`
    : 'Use current job material';
}

function operationSummary(machine: CncMachineConfig, draft: CncStartupOperationDraft): string {
  const toolId = draft.toolId ?? machine.toolId;
  const tool = machine.tools.find((candidate) => candidate.id === toolId);
  return tool?.name ?? `Unavailable bit (${toolId})`;
}

const planStyle: React.CSSProperties = { display: 'grid', gap: 7 };
const operationStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: '6px 8px',
};
const summaryStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  cursor: 'pointer',
  fontSize: 12,
};
const swatchStyle: React.CSSProperties = { width: 12, height: 12, borderRadius: 2 };
const summaryDetailStyle: React.CSSProperties = {
  marginLeft: 'auto',
  color: 'var(--lf-text-muted)',
  fontSize: 11,
};
const operationFieldsStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: 8,
  paddingTop: 9,
};
const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: 3,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
const emptyStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
