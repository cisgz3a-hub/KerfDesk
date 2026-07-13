import { layerCncTool, type CncLayerSettings, type Layer } from '../../core/scene';
import { useStore } from '../state';
import { NumberField } from './CncLayerPrimitives';

export function AdaptivePocketFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element | null {
  const machine = useStore((state) => state.project.machine);
  if (
    props.settings.cutType !== 'pocket' ||
    props.settings.pocketStrategy !== 'adaptive' ||
    machine?.kind !== 'cnc'
  ) {
    return null;
  }
  const diameterMm = layerCncTool(machine, props.settings).diameterMm;
  return (
    <NumberField
      layer={props.layer}
      label="Optimal load"
      unit="mm"
      value={props.settings.adaptiveOptimalLoadMm ?? diameterMm * 0.1}
      min={0.05}
      max={diameterMm / 2}
      step={0.05}
      title="Maximum verified radial engagement for adaptive roughing. Smaller values reduce cutter load and increase machining time."
      onCommit={(adaptiveOptimalLoadMm) => props.onCommit({ adaptiveOptimalLoadMm })}
    />
  );
}
