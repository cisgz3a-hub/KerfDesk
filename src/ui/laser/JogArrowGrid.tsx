import type { JogAxisSigns } from '../../core/devices';
import type { Vec2 } from '../../core/scene';
import {
  continuousJogVector,
  jogVectorLabel,
  stepJogVector,
  type JogVector,
  type PhysicalJogDirection,
} from './jog-control-policy';
import { useHoldJog } from './use-hold-jog';

const DIRECTIONS: ReadonlyArray<{
  readonly direction: PhysicalJogDirection;
  readonly glyph: string;
}> = [
  { direction: { x: -1, y: 1 }, glyph: '↖' },
  { direction: { x: 0, y: 1 }, glyph: '↑' },
  { direction: { x: 1, y: 1 }, glyph: '↗' },
  { direction: { x: -1, y: 0 }, glyph: '←' },
  { direction: { x: 1, y: 0 }, glyph: '→' },
  { direction: { x: -1, y: -1 }, glyph: '↙' },
  { direction: { x: 0, y: -1 }, glyph: '↓' },
  { direction: { x: 1, y: -1 }, glyph: '↘' },
];

export function JogArrowGrid(props: {
  readonly disabled: boolean;
  readonly stepMm: number;
  readonly feed: number;
  readonly signs: JogAxisSigns;
  readonly position: Vec2 | null;
  readonly bed: { readonly width: number; readonly height: number };
  // Continuous (press-and-hold) jog is only offered when the controller can
  // cancel an in-flight jog; otherwise the boundary-length move cannot be
  // stopped on release (F101).
  readonly continuousJogSupported: boolean;
  readonly onJog: (vector: JogVector) => void;
  readonly onCancel: () => void;
}): JSX.Element {
  return (
    <div style={gridStyle}>
      {DIRECTIONS.slice(0, 4).map((item) => (
        <JogArrowButton key={item.glyph} {...item} {...props} />
      ))}
      <span style={centerStyle} aria-hidden="true">
        ·
      </span>
      {DIRECTIONS.slice(4).map((item) => (
        <JogArrowButton key={item.glyph} {...item} {...props} />
      ))}
    </div>
  );
}

function JogArrowButton(
  props: {
    readonly direction: PhysicalJogDirection;
    readonly glyph: string;
  } & Parameters<typeof JogArrowGrid>[0],
): JSX.Element {
  const stepVector = stepJogVector(props.direction, props.stepMm, props.signs, props.feed);
  const label = jogVectorLabel(stepVector, props.stepMm);
  const handlers = useHoldJog({
    disabled: props.disabled,
    holdEnabled: props.continuousJogSupported,
    onStep: () => props.onJog(stepVector),
    onHold: () => {
      const vector = continuousJogVector(
        props.direction,
        props.position,
        props.bed,
        props.signs,
        props.feed,
      );
      if (vector !== null) props.onJog(vector);
    },
    onCancel: props.onCancel,
  });
  return (
    <button
      type="button"
      disabled={props.disabled}
      style={btnStyle}
      aria-label={label}
      title={props.continuousJogSupported ? `${label}. Hold for continuous jog.` : label}
      {...handlers}
    >
      {props.glyph}
    </button>
  );
}

const gridStyle: React.CSSProperties = {
  gridArea: 'arrows',
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 36px)',
  gridTemplateRows: 'repeat(3, 36px)',
  gap: 4,
  justifyContent: 'center',
};
const centerStyle: React.CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  color: 'var(--lf-text-faint)',
};
const btnStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  fontSize: 16,
  cursor: 'pointer',
};
