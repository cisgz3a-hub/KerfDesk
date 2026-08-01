import { useCallback, useState } from 'react';
import { activeCncTool, type CncMachineConfig, type CncTool } from '../../core/scene';
import { CncBitPreviewToast } from '../cnc-viewer3d/CncBitPreviewToast';
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
  const [previewTool, setPreviewTool] = useState<CncTool | null>(null);
  const dismissPreview = useCallback(() => setPreviewTool(null), []);

  const changeActiveBit = (toolId: string): void => {
    if (toolId === activeTool.id) return;
    const selectedTool = props.machine.tools.find((tool) => tool.id === toolId);
    if (selectedTool === undefined) return;
    const before = useStore.getState().project;
    updateCncMachine({ toolId });
    setPreviewTool(selectedTool);
    // Zustand updates synchronously. Inspect the resulting scene so a material
    // recipe that successfully recalculated does not receive a retained-values
    // warning, while manual/starter values whose provenance was withdrawn do.
    const after = useStore.getState().project;
    const afterMachine = after.machine;
    if (
      afterMachine?.kind === 'cnc' &&
      hasActiveBitDependentRetainedFeeds(after.scene, afterMachine) &&
      hasRetainedFeedsAfterEffectiveToolChange(before, after)
    ) {
      pushToast(CNC_RETAINED_FEEDS_WARNING, 'warning');
    }
  };

  return (
    <>
      <select
        value={activeTool.id}
        onChange={(event) => changeActiveBit(event.target.value)}
        aria-label="Active bit"
        title="The bit in the spindle. Profile offsets and pocket clearing use its diameter."
        style={props.style}
      >
        <CncToolOptions tools={props.machine.tools} />
      </select>
      {previewTool === null ? null : (
        <CncBitPreviewToast tool={previewTool} onDismiss={dismissPreview} />
      )}
    </>
  );
}
