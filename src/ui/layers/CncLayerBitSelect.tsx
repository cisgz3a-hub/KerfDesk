import {
  DEFAULT_CNC_TOOLS,
  activeCncTool,
  type CncLayerSettings,
  type CncTool,
  type Layer,
} from '../../core/scene';
import { CNC_RETAINED_FEEDS_WARNING } from '../common/cnc-bit-change-advisory';
import { cncToolGeometryLabel } from '../common/cnc-tool-geometry-label';
import { useStore } from '../state';
import { withoutCncFeedProvenance } from '../state/cnc-feed-provenance';
import { materialFeedsPatch } from '../state/cnc-project-material';
import { useToastStore } from '../state/toast-store';
import { Row, selectStyle } from './CncLayerPrimitives';

export function useCncTools(): ReadonlyArray<CncTool> {
  return useStore((state) =>
    state.project.machine?.kind === 'cnc' ? state.project.machine.tools : DEFAULT_CNC_TOOLS,
  );
}

export function LayerBitSelect(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const tools = useCncTools();
  const machine = useStore((state) => state.project.machine);
  const profile = useStore((state) => state.project.device);
  const liveCaps = useStore((state) => state.cncLiveCaps);
  const pushToast = useToastStore((state) => state.pushToast);

  // Material-derived values follow the new cutter. Manual/starter values stay
  // exact and receive the explicit review advisory below.
  const feedsForBit = (toolId: string | undefined): Partial<CncLayerSettings> | null => {
    const source = props.settings.feedSource;
    if (machine?.kind !== 'cnc' || source?.kind !== 'material-recipe') return null;
    const tool =
      toolId === undefined ? activeCncTool(machine) : tools.find((item) => item.id === toolId);
    if (tool === undefined) return null;
    return materialFeedsPatch({
      materialKey: source.materialKey,
      tool,
      spindleRpm: props.settings.spindleRpm,
      profile,
      machineSpindleMaxRpm: machine.params.spindleMaxRpm,
      liveCaps,
      fluteCount: source.fluteCount,
    });
  };

  const changeBit = (value: string): void => {
    if (value === (props.settings.toolId ?? '')) return;
    const toolId = value === '' ? undefined : value;
    let base: CncLayerSettings;
    if (toolId === undefined) {
      const { toolId: _removed, ...rest } = props.settings;
      base = rest;
    } else {
      base = { ...props.settings, toolId };
    }
    const activeToolId = machine?.kind === 'cnc' ? activeCncTool(machine).id : '';
    const currentEffectiveToolId = props.settings.toolId ?? activeToolId;
    const nextEffectiveToolId = toolId ?? activeToolId;
    if (currentEffectiveToolId === nextEffectiveToolId) {
      // The binding changed between "follow Active bit" and an explicit id,
      // but the cutter did not. Preserve settings/provenance and stay silent.
      props.onCommitSettings(base);
      return;
    }
    const feeds = feedsForBit(toolId);
    props.onCommitSettings(feeds === null ? withoutCncFeedProvenance(base) : { ...base, ...feeds });
    if (feeds === null) pushToast(CNC_RETAINED_FEEDS_WARNING, 'warning');
  };

  return (
    <Row label="Bit">
      <select
        value={props.settings.toolId ?? ''}
        onChange={(event) => changeBit(event.target.value)}
        aria-label={`Bit for ${props.layer.color}`}
        title="Which bit cuts this layer. Layers with different bits become a multi-bit job with M0 tool-change pauses."
        style={selectStyle}
      >
        <option value="">Machine bit (active)</option>
        {tools.map((tool) => (
          <option key={tool.id} value={tool.id}>
            {cncToolGeometryLabel(tool)} — {tool.name}
          </option>
        ))}
      </select>
    </Row>
  );
}
