// PocketFillRow — Easel-style pocket Fill Method (ADR-105 G10): offset rings
// (default, the original behavior) or serpentine raster sweeps along X or Y.
// Renders only for pocket layers.

import type { CncLayerSettings, Layer } from '../../core/scene';

type PocketStrategy = NonNullable<CncLayerSettings['pocketStrategy']>;

const OPTIONS: ReadonlyArray<{ readonly value: PocketStrategy; readonly label: string }> = [
  { value: 'offset', label: 'Offset rings' },
  { value: 'raster-x', label: 'Raster — X sweeps' },
  { value: 'raster-y', label: 'Raster — Y sweeps' },
];

export function PocketFillRow(props: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly onCommit: (patch: Partial<CncLayerSettings>) => void;
}): JSX.Element | null {
  if (props.settings.cutType !== 'pocket') return null;
  const value = props.settings.pocketStrategy ?? 'offset';
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>Fill method</span>
      <select
        aria-label="Pocket fill method"
        title="How the pocket interior is cleared: contour-parallel offset rings, or serpentine raster sweeps along one axis. The finishing wall pass runs last either way."
        value={value}
        onChange={(e) => {
          const next = OPTIONS.find((option) => option.value === e.target.value);
          if (next !== undefined) props.onCommit({ pocketStrategy: next.value });
        }}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
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
