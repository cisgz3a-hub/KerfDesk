// DesignLayerSettings — the active layer's operation settings. Startup Setup
// owns cutter assignment under ADR-291; the Studio keeps legacy saved ids
// visible without offering another authoring surface. Numeric entry commits on
// blur or Enter so half-typed values never thrash the 3D preview.

import type { CncTool } from '../../../core/scene';
import type { DesignLayer, DesignLayerPatch } from '../../../core/design/layers';
import { cncToolGeometryLabel } from '../../common/cnc-tool-geometry-label';
import { SetupOwnedValueRow } from '../../layers/SetupOwnedValueRow';
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
  const flatDepthEnabled = layer.vCarveFlatDepthEnabled ?? true;
  const showClearingReference =
    layer.vClearToolId !== undefined || (layer.cutType === 'v-carve' && flatDepthEnabled);
  return (
    <div style={DESIGN_SETTINGS_STYLE}>
      <DesignLayerFields
        layer={layer}
        stockThicknessMm={props.stockThicknessMm}
        onPatch={props.onPatch}
      />
      <section aria-label="Cutter assignments from Startup Setup" style={referenceSectionStyle}>
        <p style={referenceHintStyle}>
          Read-only here. Apply the design, then edit its operation in Startup Setup › Tool Plan.
        </p>
        <SetupOwnedValueRow
          label="Bit"
          value={primaryBitValue(layer, tools, props.activeTool)}
          description={primaryBitDescription(layer)}
          setupField="tool-plan"
        />
        {showClearingReference ? (
          <SetupOwnedValueRow
            label="Clear bit"
            value={clearingBitValue(layer.vClearToolId, tools)}
            description={clearingBitDescription(layer)}
            setupField="tool-plan"
          />
        ) : null}
      </section>
    </div>
  );
}

function primaryBitValue(
  layer: DesignLayer,
  tools: ReadonlyArray<CncTool>,
  activeTool: CncTool,
): string {
  if (layer.toolId === undefined) return `${toolLabel(activeTool)} (Startup default)`;
  return `${savedToolLabel(layer.toolId, tools)} (saved design override)`;
}

function clearingBitValue(toolId: string | undefined, tools: ReadonlyArray<CncTool>): string {
  return toolId === undefined
    ? 'Single stage'
    : `${savedToolLabel(toolId, tools)} (saved design override)`;
}

function savedToolLabel(toolId: string, tools: ReadonlyArray<CncTool>): string {
  const tool = tools.find((candidate) => candidate.id === toolId);
  return tool === undefined ? `Unavailable bit (${toolId})` : toolLabel(tool);
}

function toolLabel(tool: CncTool): string {
  return `${cncToolGeometryLabel(tool)} — ${tool.name}`;
}

function primaryBitDescription(layer: DesignLayer): string {
  return layer.toolId === undefined
    ? 'This layer inherits the current job default bit. Apply the design first, then change the resulting operation in Startup Setup › Tool Plan.'
    : 'This saved design carries a legacy primary-bit override. It remains read-only here and is preserved when you Apply. Then edit or reset the resulting operation in Startup Setup › Tool Plan.';
}

function clearingBitDescription(layer: DesignLayer): string {
  if (layer.vClearToolId === undefined) {
    return 'This design currently uses a single-stage V-carve. Apply the design first, then assign any flat-floor clearing bit in Startup Setup › Tool Plan.';
  }
  const relevance =
    layer.cutType === 'v-carve' && (layer.vCarveFlatDepthEnabled ?? true)
      ? ''
      : ' The current cut settings do not use this clearing assignment.';
  return `This saved design carries a legacy clearing-bit override. It remains read-only here and is preserved when you Apply.${relevance} Then edit or reset the resulting operation in Startup Setup › Tool Plan.`;
}

const referenceSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const referenceHintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  lineHeight: 1.35,
  color: 'var(--lf-text-muted)',
};
