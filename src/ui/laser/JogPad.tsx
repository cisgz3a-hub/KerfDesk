// JogPad — directional jog grid. F-B5.
//
// Step sizes cover fine alignment through coarse positioning. Feed rate matches the
// device's max feed for fast positioning. Clicking a direction sends one
// $J= command for that step. Phase B initial is step-only; continuous /
// hold-down jogging is Phase B polish.

import { useState } from 'react';
import {
  jogAxisSignsForOrigin,
  profileSupportsCapability,
  type DeviceProfile,
} from '../../core/devices';
import { machineKindOf, type MachineKind } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { JogPadAirAssist } from './JogPadAirAssist';

const STEPS_MM = [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100] as const;
const FOCUS_STEPS_MM = [0.1, 0.5, 1, 2, 5] as const;
const FOCUS_FEED_MM_PER_MIN = 600;

export function JogPad({ disabled }: { readonly disabled: boolean }): JSX.Element {
  const [step, setStep] = useState<number>(10);
  const [focusStep, setFocusStep] = useState<number>(1);
  const project = useStore((s) => s.project);
  const device = project.device;
  const machineKind = machineKindOf(project.machine);
  const maxFeed = project.device.maxFeed;
  const jog = useLaserStore((s) => s.jog);
  const zeroZHere = useLaserStore((s) => s.zeroZHere);
  const feed = Math.min(maxFeed, 3000);
  const focusFeed = Math.min(maxFeed, FOCUS_FEED_MM_PER_MIN);

  // The arrows are physical directions (↑ = away from the operator, → = the
  // operator's right); the device origin decides which machine-axis sign that
  // is. G-code emission maps geometry the same way (origin-transform.ts) — a
  // hardcoded +Y here rams rear-origin machines into their front rail.
  const signs = jogAxisSignsForOrigin(device.origin);
  const deltaFor = (axis: 'x' | 'y', physicalDirection: 1 | -1): number =>
    physicalDirection * step * signs[axis];
  const send = (axis: 'x' | 'y', physicalDirection: 1 | -1): void => {
    const delta = deltaFor(axis, physicalDirection);
    void jog(axis === 'x' ? { dx: delta, feed } : { dy: delta, feed });
  };
  const jogLabel = (axis: 'x' | 'y', physicalDirection: 1 | -1): string => {
    const delta = deltaFor(axis, physicalDirection);
    return `Jog ${delta >= 0 ? '+' : '-'}${axis.toUpperCase()} ${step} mm`;
  };

  const sendFocus = (direction: 1 | -1): void => {
    void jog({ dz: direction * focusStep, feed: focusFeed });
  };

  return (
    <div style={containerStyle}>
      <div style={headerRowStyle}>
        <span style={labelStyle}>Jog</span>
        <select
          value={step}
          onChange={(e) => setStep(Number(e.target.value))}
          disabled={disabled}
          aria-label="Jog step size"
          title="Distance moved by each jog arrow click."
        >
          {STEPS_MM.map((s) => (
            <option key={s} value={s}>
              {s} mm
            </option>
          ))}
        </select>
      </div>
      <div style={jogRowStyle}>
        <JogArrowGrid disabled={disabled} onJog={send} labelFor={jogLabel} />
        <JogPadAirAssist />
      </div>
      <FocusJogControls
        device={device}
        machineKind={machineKind}
        disabled={disabled}
        focusStep={focusStep}
        setFocusStep={setFocusStep}
        onJog={sendFocus}
        onZeroZ={() => void zeroZHere()}
      />
    </div>
  );
}

function JogArrowGrid(props: {
  readonly disabled: boolean;
  readonly onJog: (axis: 'x' | 'y', physicalDirection: 1 | -1) => void;
  readonly labelFor: (axis: 'x' | 'y', physicalDirection: 1 | -1) => string;
}): JSX.Element {
  return (
    <div style={gridStyle}>
      <span />
      <Btn
        onClick={() => props.onJog('y', 1)}
        disabled={props.disabled}
        label={props.labelFor('y', 1)}
      >
        ↑
      </Btn>
      <span />
      <Btn
        onClick={() => props.onJog('x', -1)}
        disabled={props.disabled}
        label={props.labelFor('x', -1)}
      >
        ←
      </Btn>
      <span />
      <Btn
        onClick={() => props.onJog('x', 1)}
        disabled={props.disabled}
        label={props.labelFor('x', 1)}
      >
        →
      </Btn>
      <span />
      <Btn
        onClick={() => props.onJog('y', -1)}
        disabled={props.disabled}
        label={props.labelFor('y', -1)}
      >
        ↓
      </Btn>
      <span />
    </div>
  );
}

function FocusJogControls(props: {
  readonly device: DeviceProfile;
  readonly machineKind: MachineKind;
  readonly disabled: boolean;
  readonly focusStep: number;
  readonly setFocusStep: (step: number) => void;
  readonly onJog: (direction: 1 | -1) => void;
  readonly onZeroZ: () => void;
}): JSX.Element {
  const supportsZAxis = profileSupportsCapability(props.device, 'z-axis');
  const zTravelConfirmed = props.device.zTravelConfirmed === true;
  const zTravelReady = isPositive(props.device.zTravelMm);
  const isCncMachine = props.machineKind === 'cnc';
  if (!supportsZAxis && !isCncMachine) {
    return <p style={focusHintStyle}>Manual focus: adjust the laser head by hand.</p>;
  }
  // A CNC project needs Z control by definition — the machine-kind toggle is
  // the operator's declaration that this GRBL controller drives a Z axis.
  const zReady = isCncMachine || (zTravelConfirmed && zTravelReady);
  const zDisabled = props.disabled || !zReady;
  return (
    <div style={focusPanelStyle}>
      <div style={headerRowStyle}>
        <span style={labelStyle}>{isCncMachine ? 'Z axis' : 'Focus / Z'}</span>
        <select
          value={props.focusStep}
          onChange={(e) => props.setFocusStep(Number(e.target.value))}
          disabled={props.disabled}
          aria-label="Focus Z step size"
          title="Distance moved by each Z focus jog click."
        >
          {FOCUS_STEPS_MM.map((s) => (
            <option key={s} value={s}>
              {s} mm
            </option>
          ))}
        </select>
      </div>
      <div style={focusRowStyle}>
        <Btn
          onClick={() => props.onJog(1)}
          disabled={zDisabled}
          label={`Jog Z+ ${props.focusStep} mm`}
        >
          Z+
        </Btn>
        <Btn
          onClick={() => props.onJog(-1)}
          disabled={zDisabled}
          label={`Jog Z- ${props.focusStep} mm`}
        >
          Z-
        </Btn>
        {isCncMachine ? (
          <button
            type="button"
            onClick={props.onZeroZ}
            disabled={zDisabled}
            aria-label="Zero work Z at current bit height"
            title="Touch the bit to the stock top, then click to declare that height Z0 (G92 Z0)."
          >
            Zero Z
          </button>
        ) : null}
        {!zReady && (
          <span style={focusHintStyle}>Confirm Z travel in Machine Setup before using Z jog.</span>
        )}
      </div>
    </div>
  );
}

function isPositive(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function Btn({
  onClick,
  disabled,
  label,
  children,
}: {
  readonly onClick: () => void;
  readonly disabled: boolean;
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={btnStyle}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

const containerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const headerRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const labelStyle: React.CSSProperties = { fontWeight: 600 };
const focusPanelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const focusRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
};
const focusHintStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.3,
};
const jogRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(116px, 1fr) 104px',
  gridTemplateAreas: '"arrows air" "warning warning"',
  alignItems: 'stretch',
  gap: 8,
};
const gridStyle: React.CSSProperties = {
  gridArea: 'arrows',
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 4,
  justifyItems: 'center',
};
const btnStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  fontSize: 16,
  cursor: 'pointer',
};
