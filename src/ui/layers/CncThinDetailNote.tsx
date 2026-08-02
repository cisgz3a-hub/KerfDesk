// CncThinDetailNote — per-layer advisory under the V-carve cut type: fires
// when this layer's artwork holds detail finer than the generated detail path
// can represent, so the operator learns at design time
// rather than at Job Review. Text only — informs, never gates (rule 7).
//
// The check compiles the layer's V-carve medial plan, so it runs 300 ms after the
// scene or settings settle (the panel's F-A7 debounce cadence) instead of on
// every store commit; dragging artwork re-arms the timer and the compile
// happens once at rest.

import { useEffect, useState } from 'react';
// Deep imports: core/cnc's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json pins it at 67) and may only shrink.
import { collectLayerPolylines } from '../../core/cnc/collect-cnc-contours';
import { vcarveMedialPasses } from '../../core/cnc/vcarve-medial';
import { layerCncTool, type CncLayerSettings, type Layer } from '../../core/scene';
import { useStore } from '../state';

const NOTE_DEBOUNCE_MS = 300;
export function CncThinDetailNote(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
}): JSX.Element | null {
  const { layer, settings } = props;
  const objects = useStore((s) => s.project.scene.objects);
  const device = useStore((s) => s.project.device);
  const machine = useStore((s) => s.project.machine);
  const [isThinResidual, setIsThinResidual] = useState(false);
  const isVCarve = machine?.kind === 'cnc' && settings.cutType === 'v-carve';

  useEffect(() => {
    if (!isVCarve || machine?.kind !== 'cnc') {
      setIsThinResidual(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const polylines = collectLayerPolylines(objects, layer, device);
      if (polylines.length === 0) {
        setIsThinResidual(false);
        return;
      }
      setIsThinResidual(
        vcarveMedialPasses(polylines, {
          tool: layerCncTool(machine, settings),
          maxDepthMm:
            (settings.vCarveFlatDepthEnabled ?? true) ? settings.depthMm : Number.POSITIVE_INFINITY,
          depthPerPassMm: settings.depthPerPassMm,
          resolutionMm: settings.vResolutionMm,
          ...(settings.vCarveRampEntryDeg === undefined
            ? {}
            : { rampAngleDeg: settings.vCarveRampEntryDeg }),
        }).thinResidual,
      );
    }, NOTE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [isVCarve, objects, layer, device, machine, settings]);

  if (!isThinResidual) return null;
  return (
    <p role="note" style={noteStyle}>
      Some artwork is finer than the generated detail path can represent at these settings and will
      stay uncut. Thicken it, enlarge the design, or use a wider-stroke font, then confirm the
      result in the preview.
    </p>
  );
}

const noteStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-warning-fg)',
  margin: '4px 0 6px 0',
};
