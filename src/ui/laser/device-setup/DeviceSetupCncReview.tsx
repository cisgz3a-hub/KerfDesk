import { CHIPLOAD_MATERIALS } from '../../../core/cnc';
import { activeCncTool, type CncMachineConfig } from '../../../core/scene';
import { MANUAL_FEEDS_LABEL } from '../../common/cnc-material-vocabulary';
import type { CncStartupOperationDraft } from '../../state/cnc-startup-setup';
import { DeviceSetupReviewCard } from './DeviceSetupReviewSections';

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
    <DeviceSetupReviewCard
      title="CNC current job"
      onEdit={props.onEdit}
      rows={[
        ['Material', material?.label ?? MANUAL_FEEDS_LABEL],
        ['Default bit', activeCncTool(props.machine).name],
        [
          'Stock',
          `${props.machine.stock.widthMm} × ${props.machine.stock.heightMm} × ${props.machine.stock.thicknessMm} mm`,
        ],
        [
          'Tool Plan',
          `${overrides} operation${overrides === 1 ? '' : 's'} with an explicit override`,
        ],
        ['Tiling', props.machine.tiling === undefined ? 'Off' : 'On'],
      ]}
    />
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
