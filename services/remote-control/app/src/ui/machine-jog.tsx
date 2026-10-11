import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { controller } from '../core/controller';
import type { MachineStatus } from '../core/types';
import { useApp } from './hooks';
import { Icon, type IconName } from './icons';

const STEPS = [0.1, 1, 10, 50];
const FEEDS = [undefined, 1000, 3000, 6000] as const;
const HOLD_DELAY_MS = 250;

export function JogCard({ machine }: { machine: MachineStatus }) {
  const [step, setStep] = useState(1);
  const [feed, setFeed] = useState<number | undefined>(undefined);
  const socket = useApp((state) => state.socket);
  const jogAvailable = machine.availability.jog.available;
  const holdable =
    machine.jog.holdSupported === true && socket && machine.availability.hold?.available !== false;
  if (!machine.jog.xySupported) return null;
  const pad: { axis: 'x' | 'y'; direction: -1 | 1; icon: IconName; area: string; label: string }[] =
    [
      { axis: 'y', direction: 1, icon: 'up', area: '1 / 2', label: 'Jog Y+' },
      { axis: 'x', direction: -1, icon: 'left', area: '2 / 1', label: 'Jog X−' },
      { axis: 'x', direction: 1, icon: 'right', area: '2 / 3', label: 'Jog X+' },
      { axis: 'y', direction: -1, icon: 'down', area: '3 / 2', label: 'Jog Y−' },
    ];
  return (
    <div className="card">
      <div className="card-title">
        Move the head <span className="spacer" />
        {holdable ? (
          <span className="chip accent">Hold to move</span>
        ) : (
          <span className="chip">Tap to step</span>
        )}
      </div>
      <div className="steps" role="group" aria-label="Step size">
        {STEPS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={step === value}
            onClick={() => setStep(value)}
          >
            {value} mm
          </button>
        ))}
      </div>
      <div className="steps" role="group" aria-label="Jog speed">
        {FEEDS.map((value) => (
          <button
            key={value ?? 'default'}
            type="button"
            aria-pressed={feed === value}
            onClick={() => setFeed(value)}
          >
            {value === undefined ? 'PC speed' : `${value / 1000}k`}
          </button>
        ))}
      </div>
      <div className="jog">
        <div className="jogpad">
          {pad.map((item) => (
            <JogButton
              key={item.label}
              {...item}
              step={step}
              feed={feed}
              disabled={!jogAvailable}
              hold={holdable}
            />
          ))}
          <div className="hub" style={{ gridArea: '2 / 2', display: 'grid', placeItems: 'center' }}>
            XY
          </div>
        </div>
        {machine.jog.zSupported ? (
          <div className="zcol">
            <JogButton
              axis="z"
              direction={1}
              icon="up"
              label="Jog Z+"
              step={Math.min(step, 10)}
              feed={feed}
              disabled={!jogAvailable}
              hold={holdable}
              text="Z+"
            />
            <JogButton
              axis="z"
              direction={-1}
              icon="down"
              label="Jog Z−"
              step={Math.min(step, 10)}
              feed={feed}
              disabled={!jogAvailable}
              hold={holdable}
              text="Z−"
            />
          </div>
        ) : null}
      </div>
      {!jogAvailable && machine.availability.jog.reason !== undefined ? (
        <p className="note">{machine.availability.jog.reason}</p>
      ) : null}
      {machine.jog.holdSupported === true && !socket ? (
        <p className="note">Hold-to-move needs a live connection; steps still work.</p>
      ) : null}
    </div>
  );
}

function JogButton({
  axis,
  direction,
  icon,
  label,
  step,
  feed,
  disabled,
  hold,
  area,
  text,
}: {
  axis: 'x' | 'y' | 'z';
  direction: -1 | 1;
  icon: IconName;
  label: string;
  step: number;
  feed: number | undefined;
  disabled: boolean;
  hold: boolean;
  area?: string;
  text?: string;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const [held, setHeld] = useState(false);
  const release = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (holding.current) {
      holding.current = false;
      setHeld(false);
      controller.stopHold();
      return true;
    }
    return false;
  };
  useEffect(() => () => void release(), []);
  const down = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!hold) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      holding.current = true;
      setHeld(true);
      navigator.vibrate?.(12);
      void controller.startHold(axis, direction, feed);
    }, HOLD_DELAY_MS);
  };
  const up = () => {
    if (release()) return;
    if (disabled) return;
    navigator.vibrate?.(6);
    void controller.machineAction('jog_machine', {
      axis,
      direction,
      distanceMm: step,
      ...(feed === undefined ? {} : { feedMmPerMin: feed }),
    });
  };
  return (
    <button
      type="button"
      aria-label={label}
      className={held ? 'held' : undefined}
      style={area === undefined ? undefined : { gridArea: area }}
      disabled={disabled}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={() => void release()}
      onLostPointerCapture={() => void release()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {text ?? <Icon name={icon} size={26} />}
    </button>
  );
}
