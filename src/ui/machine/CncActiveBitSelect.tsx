import { activeCncTool, type CncMachineConfig } from '../../core/scene';
import {
  CNC_RETAINED_FEEDS_WARNING,
  hasActiveBitDependentRetainedFeeds,
  hasRetainedFeedsAfterEffectiveToolChange,
} from '../common/cnc-bit-change-advisory';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { CncToolOptions } from './CncToolOptions';

export function CncActiveBitSelect(props: {
  readonly machine: CncMachineConfig;
  readonly style?: React.CSSProperties;
}): JSX.Element {
  const updateCncMachine = useStore((state) => state.updateCncMachine);
  const pushToast = useToastStore((state) => state.pushToast);
  const activeTool = activeCncTool(props.machine);

  const changeActiveBit = (toolId: string): void => {
    if (toolId === activeTool.id) return;
    const before = useStore.getState().project;
    updateCncMachine({ toolId });
    // Zustand updates synchronously. Inspect the resulting scene so a material
    // recipe that successfully recalculated does not receive a retained-values
    // warning, while manual/starter values whose provenance was withdrawn do.
    const after = useStore.getState().project;
    if (
      hasActiveBitDependentRetainedFeeds(after.scene) &&
      hasRetainedFeedsAfterEffectiveToolChange(before, after)
    ) {
      pushToast(CNC_RETAINED_FEEDS_WARNING, 'warning');
    }
  };

  return (
    <select
      value={activeTool.id}
      onChange={(event) => changeActiveBit(event.target.value)}
      aria-label="Active bit"
      title="The bit in the spindle. Profile offsets and pocket clearing use its diameter."
      style={props.style}
    >
      <CncToolOptions tools={props.machine.tools} />
    </select>
  );
}
