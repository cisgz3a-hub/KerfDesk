// JogPad — directional jog grid. F-B5.
//
// Step sizes: 0.1 / 1 / 10 / 100 mm (selectable). Feed rate matches the
// device's max feed for fast positioning. Clicking a direction sends one
// $J= command for that step. Phase B initial is step-only; continuous /
// hold-down jogging is Phase B polish.

import { useState } from 'react';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';

const STEPS_MM = [0.1, 1, 10, 100] as const;

export function JogPad({ disabled }: { readonly disabled: boolean }): JSX.Element {
  const [step, setStep] = useState<number>(10);
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const jog = useLaserStore((s) => s.jog);
  const feed = Math.min(maxFeed, 3000);

  const send = (dx: number, dy: number): void => {
    void jog({ dx: dx * step, dy: dy * step, feed });
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
