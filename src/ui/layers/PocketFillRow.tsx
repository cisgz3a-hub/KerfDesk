// PocketFillRow — Easel-style pocket Fill Method (ADR-105 G10): offset rings
// (default, the original behavior) or serpentine raster sweeps along X or Y.
// Renders only for pocket layers.

import type { CncLayerSettings, Layer } from '../../core/scene';
import { useEdition } from '../licensing/edition';
import { proChoiceLabel } from '../licensing/pro-features';

type PocketStrategy = NonNullable<CncLayerSettings['pocketStrategy']>;

const OPTIONS: ReadonlyArray<{ readonly value: PocketStrategy; readonly label: string }> = [
  { value: 'offset', label: 'Offset rings' },
  { value: 'adaptive', label: 'Adaptive clearing' },
  { value: 'raster-x', label: 'Raster — X sweeps' },
  { value: 'raster-y', label: 'Raster — Y sweeps' },
];

export function PocketFillRow(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element | null {
  const edition = useEdition();
  if (props.settings.cutType !== 'pocket') return null;
  const value = props.settings.pocketStrategy ?? 'offset';
  // Adaptive clearing is a Pro tool (ADR-540): only choosing it anew asks.
  const choose = (next: PocketStrategy): void => {
    const apply = (): void => props.onCommit({ pocketStrategy: next });
    if (next === 'adaptive' && value !== 'adaptive') edition.requestPro('adaptive-clearing', apply);
    else apply();
  };
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>Fill method</span>
      <select
        aria-label="Pocket fill method"
        title="How the pocket interior is cleared: verified radial-engagement clearing with explicit entry and wall-cleanup phases, contour-parallel rings, or raster sweeps. A finishing wall pass runs last."
        value={value}
        onChange={(e) => {
          const next = OPTIONS.find((option) => option.value === e.target.value);
          if (next !== undefined) choose(next.value);
        }}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {proChoiceLabel(option.label, option.value === 'adaptive' && !edition.pro)}
          </option>
        ))}
      </select>
    </label>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  alignItems: 'center',
  gap: 8,
  marginTop: 4,
  fontSize: 12,
};
const labelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
