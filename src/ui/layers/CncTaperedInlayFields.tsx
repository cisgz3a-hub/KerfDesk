import type { CncLayerSettings, Layer } from '../../core/scene';
import type { CncTaperedInlaySettings } from '../../core/scene/cnc-tapered-inlay';
import { NumberField } from './CncLayerPrimitives';
import { taperedInlayValuePatch } from './tapered-inlay-value-patch';
import { taperedInlayPlugDepth } from '../../core/cnc/tapered-inlay-settings';

type LengthKey = Exclude<keyof CncTaperedInlaySettings, 'kind'>;
const INLAY_ROWS: ReadonlyArray<{ key: LengthKey; label: string; min: number; title: string }> = [
  {
    key: 'pocketDepthMm',
    label: 'Pocket depth',
    min: 0.05,
    title:
      'Maximum cut below the pocket starting plane. Engagement plus axial glue gap; narrow artwork may not reach it.',
  },
  {
    key: 'engagementDepthMm',
    label: 'Engagement',
    min: 0.01,
    title:
      'Nominal insertion into the pocket. Changing it adjusts Pocket depth and keeps the glue gap.',
  },
  {
    key: 'glueGapMm',
    label: 'Glue gap',
    min: 0,
    title:
      'Axial space between the plug top and pocket bottom at nominal engagement. Changing it adjusts Pocket depth.',
  },
  {
    key: 'surfaceClearanceMm',
    label: 'Surface clearance',
    min: 0.01,
    title:
      'Gap between pocket top and the lowest plug backing plane when seated. Plug cut depth is engagement plus this clearance.',
  },
  {
    key: 'fitClearanceMm',
    label: 'Radial fit gap',
    min: 0,
    title:
      'Independent per-side radial gap on reachable taper walls. This is not the axial glue gap.',
  },
  {
    key: 'pocketStartDepthMm',
    label: 'Pocket start plane',
    min: 0,
    title:
      'Depth of the already cleared pocket starting surface below program Z0 stock top. Material above it is not cleared by this pair.',
  },
  {
    key: 'plugStartDepthMm',
    label: 'Plug start plane',
    min: 0,
    title:
      'Depth of the already cleared plug starting surface below program Z0 stock top. Distinct from engagement.',
  },
  {
    key: 'pairSpacingMm',
    label: 'Pair spacing',
    min: 0.1,
    title:
      'Gap between the pocket artwork and the mirrored plug waste border in physical-right layout.',
  },
  {
    key: 'plugBorderMm',
    label: 'Plug waste border',
    min: 0.1,
    title:
      'Waste around the source bounds, large enough for both sides of the cone at full plug depth. Insufficient border is reported in Job Review.',
  },
];

export function CncTaperedInlayFields(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly intent: CncTaperedInlaySettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element {
  const { intent } = props;
  return (
    <>
      <p className="lf-cnc-settings-hint" role="note">
        Pocket depth = engagement + glue gap. Plug cut depth = engagement + surface clearance. Both
        pieces use the same V-bit and editable source. Radial fit is a separate allowance.
      </p>
      {INLAY_ROWS.map((row) => (
        <NumberField
          key={row.key}
          layer={props.layer}
          label={row.label}
          unit={row.key === 'fitClearanceMm' ? 'mm/side' : 'mm'}
          value={intent[row.key]}
          min={row.min}
          max={500}
          step={0.05}
          title={row.title}
          onCommit={(value) =>
            props.onCommit({ taperedInlay: taperedInlayValuePatch(intent, row.key, value) })
          }
        />
      ))}
      <p className="lf-cnc-settings-hint">
        Pocket program floor: Z−{format(intent.pocketStartDepthMm + intent.pocketDepthMm)} mm. Plug
        program floor: Z−{format(intent.plugStartDepthMm + taperedInlayPlugDepth(intent))} mm.
        Narrow details can remain shallower; Job Review reports lost engagement geometry.
      </p>
      <p className="lf-cnc-settings-hint">
        This operation intentionally retains the pair linkage. Review both generated pieces after a
        source or cutter edit. Fit, glue and final release of the plug backing require a material
        trial.
      </p>
    </>
  );
}

function format(value: number): number {
  return Math.round(value * 1000) / 1000;
}
