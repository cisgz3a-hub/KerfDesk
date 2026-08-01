// CncThinDetailNote — per-layer advisory under the V-carve cut type: fires
// when this layer's artwork holds detail finer than the 0.1 mm floor the
// ADR-279 detail stage can carve, so the operator learns at design time
// rather than at Job Review. Text only — informs, never gates (rule 7).
//
// The check compiles the layer's v-carve ladder, so it runs 300 ms after the
// scene or settings settle (the panel's F-A7 debounce cadence) instead of on
// every store commit; dragging artwork re-arms the timer and the compile
// happens once at rest.

import { useEffect, useState } from 'react';
// Deep imports: core/cnc's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json pins it at 67) and may only shrink.
import { collectLayerPolylines } from '../../core/cnc/collect-cnc-contours';
import { vcarveLadderPasses } from '../../core/cnc/vcarve-ladder';
import { THIN_DETAIL_RESOLUTION_MM } from '../../core/cnc/vcarve-thin-detail';
import { layerCncTool, type CncLayerSettings, type Layer } from '../../core/scene';
import { useStore } from '../state';

const NOTE_DEBOUNCE_MS = 300;
// The narrowest groove the fine detail stage can carve (ADR-279).
const MIN_CARVEABLE_DETAIL_MM = 2 * THIN_DETAIL_RESOLUTION_MM;

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
        vcarveLadderPasses(polylines, {
          tool: layerCncTool(machine, settings),
          maxDepthMm: settings.depthMm,
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
      Some artwork details are finer than {MIN_CARVEABLE_DETAIL_MM} mm — below the smallest groove
      the detail pass can carve — and will stay uncut. Thicken them or use a wider-stroke font.
    </p>
  );
}

const noteStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-warning-fg)',
  margin: '4px 0 6px 0',
};
