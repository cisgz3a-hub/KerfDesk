// FeedsCalculatorRow — chipload-based feeds & speeds calculator on the CNC
// layer card (ADR-103 G5, F-CNC24). Computes feed/plunge/depth-per-pass from
// material × bit diameter × flutes × RPM and applies them as one undoable
// layer patch. The chart values are labeled starting points (PROVISIONAL,
// see core/cnc/feeds-calculator.ts); every number stays editable after.

import { useState } from 'react';
import { calculateFeeds, CHIPLOAD_MATERIALS, type ChiploadMaterial } from '../../core/cnc';
import { layerCncTool, type CncLayerSettings, type Layer } from '../../core/scene';
import { useStore } from '../state';

const DEFAULT_FLUTES = 2;

export function FeedsCalculatorRow(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element | null {
  const machine = useStore((s) => s.project.machine);
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const [material, setMaterial] = useState<ChiploadMaterial>('plywood-mdf');
  const [flutes, setFlutes] = useState(DEFAULT_FLUTES);
  if (machine?.kind !== 'cnc') return null;

  const tool = layerCncTool(machine, props.settings);
  const rpm = props.settings.spindleRpm;
  const result = calculateFeeds({
    material,
    bitDiameterMm: tool.diameterMm,
    flutes,
    rpm,
    maxFeedMmPerMin: maxFeed,
  });
  return (
    <details style={boxStyle}>
      <summary
        style={summaryStyle}
        title="Compute starting feeds from chipload: RPM × flutes × mm-per-tooth for the layer's bit."
      >
        Feeds calculator
      </summary>
      <div style={rowStyle}>
        <label style={fieldStyle}>
          Material
          <select
            aria-label="Chipload material"
            title="Material family — picks the starting chipload band."
            value={material}
            onChange={(e) => {
              const next = CHIPLOAD_MATERIALS.find((m) => m.value === e.target.value);
              if (next !== undefined) setMaterial(next.value);
            }}
          >
            {CHIPLOAD_MATERIALS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          Flutes
          <select
            aria-label="Bit flute count"
            title="Number of cutting edges on the bit."
            value={flutes}
            onChange={(e) => setFlutes(Math.max(1, Number(e.target.value) || DEFAULT_FLUTES))}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>
      </div>
      <p style={resultStyle}>
        {tool.name} at {rpm.toLocaleString()} RPM → chipload {result.chiploadMm.toFixed(3)} mm: feed{' '}
        <strong>{result.feedMmPerMin}</strong>, plunge <strong>{result.plungeMmPerMin}</strong>{' '}
        mm/min, {result.depthPerPassMm.toFixed(1)} mm/pass. Starting points — listen to the cut.
      </p>
      <button
        type="button"
        onClick={() =>
          props.onCommit({
            feedMmPerMin: result.feedMmPerMin,
            plungeMmPerMin: result.plungeMmPerMin,
            depthPerPassMm: result.depthPerPassMm,
            spindleRpm: rpm,
          })
        }
        title="Write these feeds into the layer (one undo step). Cut type, depth, and tabs stay put."
      >
        Apply to layer
      </button>
    </details>
  );
}

const boxStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '4px 6px',
  marginTop: 4,
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, margin: '6px 0' };
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 12,
  flex: 1,
};
const resultStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '4px 0 6px 0',
};
