import type { CncTool } from '../../core/scene';

type Layout = { readonly axialScale: number; readonly radialScale: number };
export function CncToolAssemblyPreview(props: { readonly tool: CncTool }): JSX.Element {
  return (
    <figure style={figureStyle}>
      <svg
        viewBox="0 0 240 165"
        width="240"
        style={{ maxWidth: '100%' }}
        role="img"
        aria-label={`Assembly envelope for ${props.tool.name}`}
      >
        <title>Tip-relative cutter, shank and holder envelopes</title>
        <line x1={65} x2={65} y1={10} y2={150} stroke="currentColor" strokeDasharray="2 3" />
        <EnvelopeDrawing tool={props.tool} layout={assemblyLayout(props.tool)} />
        <EnvelopeLabels tool={props.tool} />
      </svg>
      <figcaption>
        Cutter, shank and holder use separate colours. Radial and axial scales differ; this is an
        envelope diagram.
      </figcaption>
    </figure>
  );
}
function assemblyLayout(tool: CncTool): Layout {
  const holders = tool.holderSegments ?? [];
  const maxHeight = Math.max(
    1,
    tool.fluteLengthMm ?? 0,
    tool.stickoutMm ?? 0,
    ...holders.map((s) => s.startMm + s.lengthMm),
  );
  const maxDiameter = Math.max(
    tool.diameterMm,
    tool.shankDiameterMm ?? 0,
    ...holders.map((s) => s.diameterMm),
  );
  return { axialScale: 125 / maxHeight, radialScale: Math.min(4, 95 / maxDiameter) };
}
function EnvelopeDrawing(props: { readonly tool: CncTool; readonly layout: Layout }): JSX.Element {
  const { tool, layout } = props;
  const length = tool.fluteLengthMm,
    stickout = tool.stickoutMm;
  const rect = (
    start: number,
    extent: number,
    diameter: number,
  ): React.SVGProps<SVGRectElement> => ({
    x: 65 - (diameter * layout.radialScale) / 2,
    y: 145 - (start + extent) * layout.axialScale,
    width: diameter * layout.radialScale,
    height: extent * layout.axialScale,
  });
  return (
    <>
      {length === undefined ? null : (
        <rect {...rect(0, length, tool.diameterMm)} fill="var(--lf-accent)" opacity={0.7} />
      )}
      {length === undefined ||
      stickout === undefined ||
      tool.shankDiameterMm === undefined ||
      stickout <= length ? null : (
        <rect
          {...rect(length, stickout - length, tool.shankDiameterMm)}
          fill="var(--lf-text-muted)"
        />
      )}
      {(tool.holderSegments ?? []).map((holder, index) => (
        <rect
          key={index}
          {...rect(holder.startMm, holder.lengthMm, holder.diameterMm)}
          fill="var(--lf-warning-fg)"
          opacity={0.6}
          stroke="currentColor"
        />
      ))}
    </>
  );
}
function EnvelopeLabels(props: { readonly tool: CncTool }): JSX.Element {
  const tool = props.tool;
  return (
    <g fill="currentColor" fontSize={10}>
      <text x={120} y={35}>
        Cutter: {tool.diameterMm} mm
      </text>
      <text x={120} y={55}>
        Flutes: {dimensionLabel(tool.fluteLengthMm)}
      </text>
      <text x={120} y={75}>
        Shank: {dimensionLabel(tool.shankDiameterMm)}
      </text>
      <text x={120} y={95}>
        Stickout: {dimensionLabel(tool.stickoutMm)}
      </text>
      <text x={120} y={115}>
        Holder: {tool.holderSegments?.length ? `${tool.holderSegments.length} segments` : 'unknown'}
      </text>
      <text x={57} y={160}>
        Tip
      </text>
    </g>
  );
}
function dimensionLabel(value: number | undefined): string {
  return value === undefined ? 'unknown' : `${value} mm`;
}
const figureStyle: React.CSSProperties = { margin: '6px 0', fontSize: 10 };
