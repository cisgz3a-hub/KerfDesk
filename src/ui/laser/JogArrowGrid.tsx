import type { ReactNode } from 'react';
import type { JogAxisSigns, MachineBounds } from '../../core/devices';
import type { Vec2 } from '../../core/scene';
import { Icon, type IconName } from '../kit/icons';
import {
  continuousJogVector,
  jogVectorLabel,
  stepJogVector,
  type JogVector,
  type PhysicalJogDirection,
} from './jog-control-policy';
import { keyboardJogHint } from './jog-keyboard-map';
import { useHoldJog } from './use-hold-jog';

const DIRECTIONS: ReadonlyArray<{
  readonly direction: PhysicalJogDirection;
  readonly icon: IconName;
}> = [
  { direction: { x: -1, y: 1 }, icon: 'arrow-up-left' },
  { direction: { x: 0, y: 1 }, icon: 'arrow-up' },
  { direction: { x: 1, y: 1 }, icon: 'arrow-up-right' },
  { direction: { x: -1, y: 0 }, icon: 'arrow-left' },
  { direction: { x: 1, y: 0 }, icon: 'arrow-right' },
  { direction: { x: -1, y: -1 }, icon: 'arrow-down-left' },
  { direction: { x: 0, y: -1 }, icon: 'arrow-down' },
  { direction: { x: 1, y: -1 }, icon: 'arrow-down-right' },
];

export function JogArrowGrid(props: {
  readonly centerAction?: ReactNode;
  readonly disabled: boolean;
  readonly stepMm: number;
  readonly feed: number;
  readonly signs: JogAxisSigns;
  readonly position: Vec2 | null;
  readonly bounds: MachineBounds;
  // Continuous (press-and-hold) jog is only offered when the controller can
  // cancel an in-flight jog; otherwise the boundary-length move cannot be
  // stopped on release (F101).
  readonly continuousJogSupported: boolean;
  readonly onJog: (vector: JogVector) => void;
  readonly onCancel: () => void;
}): JSX.Element {
  return (
    <div className="lf-jog-arrow-grid" style={gridStyle}>
      {DIRECTIONS.slice(0, 4).map((item) => (
        <JogArrowButton key={item.icon} {...item} {...props} />
      ))}
      <div
        className="lf-jog-center"
        style={centerStyle}
        aria-hidden={props.centerAction === undefined ? true : undefined}
      >
        {props.centerAction ?? <Icon name="crosshair" size={16} />}
      </div>
      {DIRECTIONS.slice(4).map((item) => (
        <JogArrowButton key={item.icon} {...item} {...props} />
      ))}
    </div>
  );
}

function JogArrowButton(
  props: {
    readonly direction: PhysicalJogDirection;
    readonly icon: IconName;
  } & Parameters<typeof JogArrowGrid>[0],
): JSX.Element {
  const stepVector = stepJogVector(props.direction, props.stepMm, props.signs, props.feed);
  const label = jogVectorLabel(stepVector, props.stepMm);
  // The tooltip names this arrow's keyboard keys (ADR-493); the accessible name
  // stays the wire command.
  const hinted = `${label} (${keyboardJogHint(props.direction)})`;
  const handlers = useHoldJog({
    disabled: props.disabled,
    holdEnabled: props.continuousJogSupported,
    onStep: () => props.onJog(stepVector),
    onHold: () => {
      const vector = continuousJogVector(
        props.direction,
        props.position,
        props.bounds,
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
      title={props.continuousJogSupported ? `${hinted}. Hold for continuous jog.` : hinted}
      {...handlers}
    >
      <Icon name={props.icon} size={20} />
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
