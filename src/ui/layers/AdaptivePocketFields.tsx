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
    <>
      <NumberField
        layer={props.layer}
        label="Radial engagement"
        unit="mm"
        value={props.settings.adaptiveOptimalLoadMm ?? diameterMm * 0.1}
        min={0.05}
        max={diameterMm / 2}
        step={0.05}
        title="Compile-time geometric radial-engagement limit for adaptive roughing. CurveDesk does not measure live cutting force or spindle/axis load and does not change feed automatically."
        onCommit={(adaptiveOptimalLoadMm) => props.onCommit({ adaptiveOptimalLoadMm })}
      />
      <p role="note" style={feedbackBoundaryStyle}>
        Geometry only — no live load sensing or automatic feed adjustment.
      </p>
    </>
  );
}

const feedbackBoundaryStyle: React.CSSProperties = {
  margin: '0 0 4px 104px',
  color: 'var(--lf-text-faint)',
  fontSize: 11,
};
