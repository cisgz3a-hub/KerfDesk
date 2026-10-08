import { rotaryUsesRollerDiameter, type RotarySetup } from '../../core/devices/rotary';
import { hintStyle, previewStyle } from './rotary-setup-dialog.styles';
import { rotaryWrapPreview, type RotaryArtworkExtent } from './rotary-wrap-preview';

export function RotaryWrapPreview(props: {
  readonly setup: RotarySetup;
  readonly artwork?: RotaryArtworkExtent | null;
  readonly outputDescription?: string;
}): JSX.Element {
  const model = rotaryWrapPreview(props.setup, props.artwork);
  if (model === null)
    return (
      <p style={hintStyle}>Enter measurements that produce finite positive wrap dimensions.</p>
    );
  return (
    <div style={previewStyle} aria-label="Rotary wrap preview">
      <span>Surface circumference: {model.circumferenceMm.toFixed(2)} mm</span>
      <span>Machine travel per revolution: {model.machineTravelMm.toFixed(2)} mm</span>
      <span>
        Y scale: ×{model.scale.toFixed(4)}{' '}
        {props.setup.type === 'roller' && !rotaryUsesRollerDiameter(props.setup)
          ? '(Y moves the surface directly)'
          : 'machine mm per surface mm'}
      </span>
      <span>
        Wrap limit: artwork up to {model.circumferenceMm.toFixed(2)} mm tall fits one revolution
      </span>
      <WrapDiagram model={model} hasArtwork={props.artwork != null} />
      {props.artwork == null ? (
        <p style={hintStyle}>Add artwork to compare its surface height with one revolution.</p>
      ) : (
        <p style={hintStyle}>
          All canvas artwork bounds: {props.artwork.widthMm.toFixed(2)} ×{' '}
          {model.artworkHeightMm.toFixed(2)} mm,
          {(model.coverage * 100).toFixed(1)}% of one turn.
          {model.overlapMm > 0
            ? ` Extends ${model.overlapMm.toFixed(2)} mm past one turn; the footprint can overlap the seam.`
            : ` ${model.remainingMm.toFixed(2)} mm remains around the circumference.`}
        </p>
      )}
      <p style={hintStyle}>
        Circumference = π × object diameter. Source: the measurements in this profile.{' '}
        {model.scaleSource}
      </p>
      <p style={hintStyle}>
        Seam reference: surface Y = 0 and Y = circumference meet on the same line around the part.
        The emitted job rebases its lowest Y to 0; the part&apos;s starting rotation chooses the
        physical seam.
        {model.reverse
          ? ' Reverse mirrors traversal within the artwork extent.'
          : ' Normal direction increases surface Y.'}
      </p>
      <p style={hintStyle}>
        Mathematical bounds diagram; X is schematic. Operation selection, clipping, raster overscan
        and generated paths can change the output footprint. Review the prepared job and Frame its
        placement.
        {props.outputDescription === undefined
          ? ''
          : ` Current output: ${props.outputDescription}.`}{' '}
        This diagram does not establish controller or accessory compatibility.
      </p>
    </div>
  );
}

function WrapDiagram(props: {
  readonly model: NonNullable<ReturnType<typeof rotaryWrapPreview>>;
  readonly hasArtwork: boolean;
}): JSX.Element {
  const { model } = props;
  const height = Math.min(1, model.coverage) * 100;
  return (
    <svg
      viewBox="0 0 380 160"
      role="img"
      aria-label="Unwrapped rotary surface and seam"
      style={{ width: '100%', maxHeight: 170 }}
    >
      <title>One object revolution, unwrapped</title>
      <rect
        x="52"
        y="30"
        width="280"
        height="100"
        fill="var(--lf-bg-2)"
        stroke="var(--lf-border)"
      />
      {props.hasArtwork ? (
        <rect
          x="72"
          y="30"
          width="240"
          height={height}
          fill="var(--lf-accent)"
          fillOpacity="0.25"
          stroke="var(--lf-accent)"
        />
      ) : null}
      <path d="M52 30 H332 M52 130 H332" stroke="var(--lf-warning)" strokeDasharray="5 3" />
      <text x="52" y="20" fill="var(--lf-text)" fontSize="11">
        Seam · Y = 0
      </text>
      <text x="52" y="148" fill="var(--lf-text)" fontSize="11">
        Same seam · Y = {model.circumferenceMm.toFixed(2)} mm
      </text>
      <text x="350" y="83" fill="var(--lf-text)" fontSize="18">
        {model.reverse ? '↑' : '↓'}
      </text>
      {model.overlapMm > 0 ? (
        <text x="192" y="87" textAnchor="middle" fill="var(--lf-text)" fontSize="12">
          Footprint exceeds one turn
        </text>
      ) : null}
    </svg>
  );
}
