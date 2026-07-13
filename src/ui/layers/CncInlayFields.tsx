import type { CncLayerSettings, Layer } from '../../core/scene';
import { NumberField } from './CncLayerPrimitives';

export function CncInlayFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element | null {
  if (props.settings.cutType !== 'inlay-pair') return null;
  const pocketDepthMm = props.settings.inlayPocketDepthMm ?? Math.min(3, props.settings.depthMm);
  return (
    <>
      <NumberField
        layer={props.layer}
        label="Pocket depth"
        unit="mm"
        value={pocketDepthMm}
        min={0.05}
        max={200}
        step={0.25}
        title="Depth of the female inlay pocket. The insert profile uses the Cut depth above."
        onCommit={(inlayPocketDepthMm) => props.onCommit({ inlayPocketDepthMm })}
      />
      <NumberField
        layer={props.layer}
        label="Fit clearance"
        unit="mm/side"
        value={props.settings.inlayAllowanceMm ?? 0.1}
        min={0}
        max={2}
        step={0.02}
        title="Finished clearance on each edge. The linked pocket expands and the insert contracts by half this value each."
        onCommit={(inlayAllowanceMm) => props.onCommit({ inlayAllowanceMm })}
      />
      <NumberField
        layer={props.layer}
        label="Pair spacing"
        unit="mm"
        value={props.settings.inlayPairSpacingMm ?? 10}
        min={0.1}
        max={500}
        step={1}
        title="Gap between the original pocket and the automatically mirrored insert."
        onCommit={(inlayPairSpacingMm) => props.onCommit({ inlayPairSpacingMm })}
      />
    </>
  );
}
