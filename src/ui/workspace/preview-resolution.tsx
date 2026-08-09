import type {
  RemovalGridResolution,
  RemovalGridResolutionReason,
} from '../../core/sim/removal-grid';

const REASON_TEXT: Readonly<Record<RemovalGridResolutionReason, string>> = {
  'minimum-cell-size': 'the minimum preview cell size',
  'removal-grid-cell-budget': 'the removal-grid memory budget',
  'interactive-preview-cell-budget': 'the interactive preview cell budget',
  'display-mesh-cell-budget': 'the 3D display mesh budget',
  'caller-selected-cell-size': 'the selected preview cell size',
};

/** Nonblocking, user-facing disclosure for an adjusted preview resolution. */
export function previewResolutionMessage(
  label: string,
  resolution: RemovalGridResolution,
): string | null {
  if (resolution.reason === null) return null;
  return `${label} uses ${formatMm(resolution.effectiveMmPerCell)} mm cells instead of the requested ${formatMm(resolution.requestedMmPerCell)} mm cells to stay within ${REASON_TEXT[resolution.reason]}. Preview only; CAM and G-code are unchanged.`;
}

/** Existing warning styling with status semantics; informational and never a guard. */
export function PreviewResolutionBanner(props: {
  readonly label: string;
  readonly resolution: RemovalGridResolution | undefined;
}): JSX.Element | null {
  if (props.resolution === undefined) return null;
  const message = previewResolutionMessage(props.label, props.resolution);
  if (message === null) return null;
  return (
    <div className="lf-banner lf-banner--warning" style={bannerStyle} role="status">
      {message}
    </div>
  );
}

const bannerStyle: React.CSSProperties = { fontFamily: 'system-ui, sans-serif' };

function formatMm(value: number): string {
  return (Math.round(value * 1_000_000) / 1_000_000).toString();
}
