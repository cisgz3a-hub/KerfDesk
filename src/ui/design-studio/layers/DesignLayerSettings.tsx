// DesignLayerSettings — the active layer's carve settings (ADR-272
// Amendment 1): kind, depth, bit, and the v-carve clearing bit. Numeric entry
// commits on blur or Enter, the numeric-field convention the main inspector
// uses, so half-typed values never thrash the 3D preview.

import type { CncTool } from '../../../core/scene';
import type { DesignLayer, DesignLayerPatch } from '../../../core/design/layers';
import { CNC_SECONDARY_RETAINED_FEEDS_WARNING } from '../../common/cnc-bit-change-advisory';
import { useToastStore } from '../../state/toast-store';
import { DesignLayerBitSelectField } from './DesignLayerBitSelectField';
import { DesignLayerFields } from './DesignLayerFields';
import { DESIGN_SETTINGS_STYLE } from './design-layer-settings-styles';

export function DesignLayerSettings(props: {
  readonly layer: DesignLayer;
  readonly tools: ReadonlyArray<CncTool>;
  readonly activeTool: CncTool;
  readonly stockThicknessMm: number;
  readonly onPatch: (patch: DesignLayerPatch) => void;
}): JSX.Element {
  const { layer, tools } = props;
  const pushToast = useToastStore((state) => state.pushToast);
  const flatTools = tools.filter((tool) => tool.kind === 'end-mill');
  const currentTool = tools.find((tool) => tool.id === layer.toolId);
  const primaryToolId = currentTool?.id ?? props.activeTool.id;
  const currentClearTool = tools.find((tool) => tool.id === layer.vClearToolId);
  const flatDepthEnabled = layer.vCarveFlatDepthEnabled ?? true;
  return (
    <div style={DESIGN_SETTINGS_STYLE}>
      <DesignLayerFields
        layer={layer}
        stockThicknessMm={props.stockThicknessMm}
        onPatch={props.onPatch}
      />
      <DesignLayerBitSelectField
        label="Bit"
        title="The bit this layer cuts with. Layers with different bits become a multi-bit job with tool-change pauses."
        value={layer.toolId}
        emptyLabel="Machine bit (active)"
        tools={tools}
        currentTool={currentTool}
        unavailablePrefix="Current unavailable bit"
        onSelect={(toolId) => props.onPatch({ toolId })}
      />
      {layer.cutType === 'v-carve' && flatDepthEnabled ? (
        <DesignLayerBitSelectField
          label="Clear"
          title="Two-stage v-carve: flat floors beyond the v-bit's reach are pocket-cleared with this bit first"
          value={layer.vClearToolId}
          emptyLabel="Single stage (v-bit only)"
          // Clearing is a constant-Z pocket pass. Only the flat end-mill
          // kernel can truthfully leave the floor this control promises.
          tools={flatTools}
          currentTool={currentClearTool}
          unavailablePrefix="Current unsupported clearing bit (choose a flat end mill)"
          onSelect={(vClearToolId) => {
            props.onPatch({ vClearToolId });
            if (vClearToolId !== null && vClearToolId !== primaryToolId) {
              pushToast(CNC_SECONDARY_RETAINED_FEEDS_WARNING, 'warning');
            }
          }}
        />
      ) : null}
    </div>
  );
}
