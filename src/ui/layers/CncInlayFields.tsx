import { type CncLayerSettings, type Layer } from '../../core/scene';
import { DEFAULT_CNC_TAPERED_INLAY } from '../../core/scene/cnc-tapered-inlay';
import { NumberField, Row, selectStyle } from './CncLayerPrimitives';
import { CncTaperedInlayFields } from './CncTaperedInlayFields';
import { RailSection } from '../kit';

type InlayFieldsProps = {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
};

export function CncInlayFields(props: InlayFieldsProps): JSX.Element | null {
  if (props.settings.cutType !== 'inlay-pair') return null;
  return (
    <RailSection
      label="Inlay fit"
      badge={props.settings.taperedInlay === undefined ? 'Straight pair' : 'Linked V-bit pair'}
      hint="Choose a straight profile pair or a tapered V-bit pair; both derive from this artwork."
    >
      <Row label="Pair method">
        <select
          value={props.settings.taperedInlay === undefined ? 'straight' : 'tapered-v'}
          style={selectStyle}
          aria-label={`Inlay pair method for ${props.layer.color}`}
          title="Generate a straight end-mill pair or a linked tapered pair using the selected pointed V-bit."
          onChange={(event) =>
            props.onCommit({
              taperedInlay:
                event.target.value === 'tapered-v' ? { ...DEFAULT_CNC_TAPERED_INLAY } : undefined,
            })
          }
        >
          <option value="straight">Straight end-mill pair</option>
          <option value="tapered-v">Tapered V-bit pair</option>
        </select>
      </Row>
      {props.settings.taperedInlay === undefined ? (
        <StraightInlayFields {...props} />
      ) : (
        <CncTaperedInlayFields {...props} intent={props.settings.taperedInlay} />
      )}
    </RailSection>
  );
}

function StraightInlayFields(props: InlayFieldsProps): JSX.Element {
  return (
    <>
      <NumberField
        layer={props.layer}
        label="Pocket depth"
        unit="mm"
        value={props.settings.inlayPocketDepthMm ?? Math.min(3, props.settings.depthMm)}
        min={0.05}
        max={200}
        step={0.25}
        title="Depth of the female inlay pocket. The insert profile uses Insert depth above."
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
