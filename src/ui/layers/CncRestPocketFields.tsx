import { activeCncTool, type CncLayerSettings, type Layer } from '../../core/scene';
import { useStore } from '../state';
import { Row } from './CncLayerPrimitives';
import { useCncTools } from './CncLayerToolFields';

export function RestPocketToolSelect(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommitSettings: (settings: CncLayerSettings) => void;
}): JSX.Element {
  const tools = useCncTools();
  const machine = useStore((state) => state.project.machine);
  const currentTool =
    tools.find((tool) => tool.id === props.settings.toolId) ??
    (machine?.kind === 'cnc' ? activeCncTool(machine) : tools[0]);
  const roughers = tools.filter(
    (tool) =>
      tool.kind === 'end-mill' &&
      currentTool !== undefined &&
      tool.diameterMm > currentTool.diameterMm,
  );
  return (
    <Row label="Rough first">
      <select
        value={props.settings.pocketRoughToolId ?? ''}
        onChange={(event) => commitRoughingTool(event.target.value, props)}
        aria-label={`Pocket roughing bit for ${props.layer.color}`}
        title="Clear the bulk with a larger end mill, then use this layer's bit only on stock the rougher could not reach."
        style={selectStyle}
      >
        <option value="">Single bit</option>
        {roughers.map((tool) => (
          <option key={tool.id} value={tool.id}>
            {tool.name}
          </option>
        ))}
      </select>
    </Row>
  );
}

function commitRoughingTool(
  toolId: string,
  props: {
    readonly settings: CncLayerSettings;
    readonly onCommitSettings: (settings: CncLayerSettings) => void;
  },
): void {
  if (toolId === '') {
    const { pocketRoughToolId: _removed, ...rest } = props.settings;
    props.onCommitSettings(rest);
    return;
  }
  const { helixEntry: _removed, ...rest } = props.settings;
  props.onCommitSettings({ ...rest, pocketRoughToolId: toolId });
}

const selectStyle: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 12, padding: '2px 4px' };
