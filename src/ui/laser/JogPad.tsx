// JogPad — directional jog grid. F-B5.
//
// Step sizes cover fine alignment through coarse positioning. Feed rate matches the
// device's max feed for fast positioning. Clicking a direction sends one
// $J= command for that step. Phase B initial is step-only; continuous /
// hold-down jogging is Phase B polish.

import { useState } from 'react';
import { profileSupportsCapability, type DeviceProfile } from '../../core/devices';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';

const STEPS_MM = [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100] as const;
const FOCUS_STEPS_MM = [0.1, 0.5, 1, 2, 5] as const;
const FOCUS_FEED_MM_PER_MIN = 600;

export function JogPad({ disabled }: { readonly disabled: boolean }): JSX.Element {
  const [step, setStep] = useState<number>(10);
  const [focusStep, setFocusStep] = useState<number>(1);
  const device = useStore((s) => s.project.device);
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const jog = useLaserStore((s) => s.jog);
  const feed = Math.min(maxFeed, 3000);
  const focusFeed = Math.min(maxFeed, FOCUS_FEED_MM_PER_MIN);

  const send = (dx: number, dy: number): void => {
    void jog({ dx: dx * step, dy: dy * step, feed });
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
      <div style={gridStyle}>
        <span />
        {/* For front-left/right origin, "↑ away from operator" maps to +Y in
            machine coords. We send +dy for ↑ and -dy for ↓ accordingly. */}
        <Btn onClick={() => send(0, 1)} disabled={disabled} label={`Jog +Y ${step} mm`}>
          ↑
        </Btn>
        <span />
        <Btn onClick={() => send(-1, 0)} disabled={disabled} label={`Jog -X ${step} mm`}>
          ←
        </Btn>
        <span />
        <Btn onClick={() => send(1, 0)} disabled={disabled} label={`Jog +X ${step} mm`}>
          →
        </Btn>
        <span />
        <Btn onClick={() => send(0, -1)} disabled={disabled} label={`Jog -Y ${step} mm`}>
          ↓
        </Btn>
        <span />
      </div>
      <FocusJogControls
        device={device}
        disabled={disabled}
        focusStep={focusStep}
        setFocusStep={setFocusStep}
        onJog={sendFocus}
      />
    </div>
  );
}

function FocusJogControls(props: {
  readonly device: DeviceProfile;
  readonly disabled: boolean;
  readonly focusStep: number;
  readonly setFocusStep: (step: number) => void;
  readonly onJog: (direction: 1 | -1) => void;
}): JSX.Element {
  const supportsZAxis = profileSupportsCapability(props.device, 'z-axis');
  const zTravelConfirmed = props.device.zTravelConfirmed === true;
  if (!supportsZAxis) {
    return <p style={focusHintStyle}>Manual focus: adjust the laser head by hand.</p>;
  }
  const zDisabled = props.disabled || !zTravelConfirmed;
  return (
    <div style={focusPanelStyle}>
      <div style={headerRowStyle}>
        <span style={labelStyle}>Focus / Z</span>
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
        {!zTravelConfirmed && (
          <span style={focusHintStyle}>Confirm Z travel in Machine Setup before using Z jog.</span>
        )}
      </div>
    </div>
  );
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
const gridStyle: React.CSSProperties = {
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
