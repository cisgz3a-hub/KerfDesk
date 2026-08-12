import { CHIPLOAD_MATERIALS } from '../../../core/cnc';
import { activeCncTool, type CncMachineConfig } from '../../../core/scene';
import { Button } from '../../kit';
import { MANUAL_FEEDS_LABEL } from '../../common/cnc-material-vocabulary';
import type { CncStartupOperationDraft } from '../../state/cnc-startup-setup';

export function DeviceSetupCncReview(props: {
  readonly machine: CncMachineConfig;
  readonly operationDrafts: ReadonlyArray<CncStartupOperationDraft>;
  readonly onEdit: () => void;
}): JSX.Element {
  const material = CHIPLOAD_MATERIALS.find(
    (candidate) => candidate.value === props.machine.stock.materialKey,
  );
  const overrides = props.operationDrafts.filter(hasOperationOverride).length;
  return (
    <article style={cardStyle}>
      <header style={headerStyle}>
        <strong>CNC current job</strong>
        <Button variant="ghost" onClick={props.onEdit}>
          Edit
        </Button>
      </header>
      <dl style={definitionStyle}>
        <ReviewRow label="Material" value={material?.label ?? MANUAL_FEEDS_LABEL} />
        <ReviewRow label="Default bit" value={activeCncTool(props.machine).name} />
        <ReviewRow
          label="Stock"
          value={`${props.machine.stock.widthMm} × ${props.machine.stock.heightMm} × ${props.machine.stock.thicknessMm} mm`}
        />
        <ReviewRow
          label="Tool Plan"
          value={`${overrides} operation${overrides === 1 ? '' : 's'} with an explicit override`}
        />
        <ReviewRow label="Tiling" value={props.machine.tiling === undefined ? 'Off' : 'On'} />
      </dl>
    </article>
  );
}

function hasOperationOverride(draft: CncStartupOperationDraft): boolean {
  return (
    draft.toolId !== null ||
    draft.vClearToolId !== null ||
    draft.pocketRoughToolId !== null ||
    draft.reliefFinishToolId !== null
  );
}

function ReviewRow(props: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </>
  );
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 8,
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 5,
  fontSize: 12,
};
const definitionStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '130px minmax(0, 1fr)',
  gap: '4px 10px',
  margin: 0,
  fontSize: 12,
};
