// Viewer3DReadout — X/Y and cut depth under the cursor.
//
// Presentational: it formats a reading someone else took. The machine-readable
// probe span mirrors the canvas-motion-probe pattern so an e2e run can assert
// the numbers without trying to read them off a WebGL canvas.

const MM_DECIMALS = 2;

export type SurfaceReadingView = {
  readonly xMm: number;
  readonly yMm: number;
  // <= 0. Zero is untouched stock.
  readonly depthMm: number;
};

export function Viewer3DReadout(props: {
  readonly reading: SurfaceReadingView | null;
}): JSX.Element {
  const { reading } = props;
  return (
    <div style={rowStyle}>
      <span
        data-testid="viewer3d-readout-probe"
        data-x-mm={reading === null ? '' : reading.xMm.toFixed(MM_DECIMALS)}
        data-y-mm={reading === null ? '' : reading.yMm.toFixed(MM_DECIMALS)}
        data-depth-mm={reading === null ? '' : reading.depthMm.toFixed(MM_DECIMALS)}
        style={probeStyle}
      />
      {reading === null ? (
        <span style={mutedStyle}>Hover the part to read position and depth.</span>
      ) : (
        <span>
          {/* Depth is stored negative-into-material; the minus sign is noise
              next to the word "depth", so it shows as a magnitude. */}
          X {reading.xMm.toFixed(MM_DECIMALS)} · Y {reading.yMm.toFixed(MM_DECIMALS)} · depth{' '}
          {Math.abs(reading.depthMm).toFixed(MM_DECIMALS)} mm
        </span>
      )}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
  minHeight: 16,
};
const mutedStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
// Present in the DOM for tests, invisible and unreachable to a reader.
const probeStyle: React.CSSProperties = { display: 'none' };
