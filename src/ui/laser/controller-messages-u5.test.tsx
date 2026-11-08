// Controller messages a beginner can act on (UX audit U5-P3-1, U5-P3-2 with
// U4-P3-4, U5-P3-3, U5-P3-4, U5-P3-5 with U4-P3-2, U5-P3-6, U5-P3-7, U5-P3-13).
import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { controllerAttention } from '../state/controller-attention';
import { controllerHaltedNotice } from '../state/laser-safety-notice';
import { handleLine } from '../state/laser-line-handler';
import { makeLineHandlerHarness } from '../state/laser-line-handler.test-support';
import { AlarmBanner } from './AlarmBanner';
import { alarmCardAction, alarmControllerKind, isHomingFailureAlarm } from './alarm-card-advice';
import { ConnectionBar } from './ConnectionBar';
import { controllerSelectionChanges } from './device-setup/device-setup-controller-selection';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
});

function render(element: JSX.Element): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(element));
  unmount = () => {
    act(() => root.unmount());
    host.remove();
  };
  return host;
}

const noop = (): void => undefined;

function banner(overrides: Partial<ComponentProps<typeof AlarmBanner>>): HTMLDivElement {
  return render(
    <AlarmBanner
      code={1}
      controllerKind="grbl-v1.1"
      homingEnabled={false}
      homeFromAlarm={true}
      canUnlock={true}
      resetRequired={false}
      onHome={noop}
      onConfigureHoming={noop}
      onUnlock={noop}
      onReset={noop}
      {...overrides}
    />,
  );
}

function buttonLabels(host: HTMLElement): ReadonlyArray<string> {
  return [...host.querySelectorAll('button')].map((button) => button.textContent ?? '');
}

describe('the Alarm card after Reset (U4-P3-4, U5-P3-2)', () => {
  it('names the next step only, and Unlock on a machine with homing off', () => {
    const host = banner({ code: 1, homingEnabled: false });
    expect(host.textContent).not.toContain('press Reset');
    expect(host.textContent).toContain(
      'Clear whatever the head ran into, move it off the limit switch, and check that the design and origin fit the bed. Then Unlock ($X).',
    );
    expect(host.textContent).not.toContain('re-home');
  });

  it('names Home when homing is on', () => {
    expect(alarmCardAction(1, 'grbl-v1.1', undefined, true)).toMatch(
      /Then Home \(\$H\) to find the position again\.$/,
    );
    expect(alarmCardAction(2, 'grblhal', undefined, false)).toBe(
      'The position is kept, so Unlock ($X) is safe. Then check that the design fits the bed.',
    );
  });

  it('keeps the physical step and Reset while the reset is still required', () => {
    const host = banner({ code: 1, resetRequired: true });
    expect(host.textContent).toContain('move it off the limit switch');
    expect(buttonLabels(host)).toEqual(['Reset (Ctrl-X)']);
  });
});

describe('a homing failure (U5-P3-3)', () => {
  it('asks about switches and puts Unlock and Machine Setup before Home', () => {
    const host = banner({ code: 9, homingEnabled: true });
    expect(host.textContent).toContain(
      "Homing couldn't find a switch. If this machine has no homing switches, turn Home off in Machine Setup",
    );
    expect(buttonLabels(host)).toEqual(['$X — Unlock', 'Machine Setup', 'Home ($H)']);
  });

  it('covers ALARM:8, 9 and grblHAL 15, not other alarms or FluidNC', () => {
    expect(isHomingFailureAlarm(8, 'grbl-v1.1')).toBe(true);
    expect(isHomingFailureAlarm(15, 'grblhal')).toBe(true);
    expect(isHomingFailureAlarm(15, 'grbl-v1.1')).toBe(false);
    expect(isHomingFailureAlarm(1, 'grbl-v1.1')).toBe(false);
    expect(isHomingFailureAlarm(9, 'fluidnc')).toBe(false);
  });
});

describe('a banner-less grblHAL on the stock driver (U5-P3-4)', () => {
  it('decodes ALARM:10 as the E-stop once $I named grblHAL', () => {
    const session = {
      activeControllerKind: 'grbl-v1.1' as const,
      detectedControllerKind: null,
      controllerSettings: null,
      controllerBuildInfoRawLines: ['[VER:1.1f.20230101:]', '[FIRMWARE:grblHAL]'],
    };
    expect(alarmControllerKind(session)).toBe('grblhal');
    const host = banner({ code: 10, controllerKind: alarmControllerKind(session) });
    expect(host.textContent).toContain('E-stop asserted');
    expect(host.textContent).not.toContain('dual-axis');
    expect(alarmControllerKind({ ...session, controllerBuildInfoRawLines: [] })).toBe('grbl-v1.1');
  });
});

describe('the toolbar pill (U5-P3-1, U5-P3-6)', () => {
  const connected = { kind: 'connected' } as const;

  it('reads Alarm and Halted, never a plain green Connected', () => {
    expect(
      controllerAttention({
        connection: connected,
        safetyNotice: null,
        statusReport: null,
        alarmCode: 1,
      }),
    ).toBe('alarm');
    expect(
      controllerAttention({
        connection: connected,
        safetyNotice: controllerHaltedNotice('kill() called'),
        statusReport: null,
        alarmCode: null,
      }),
    ).toBe('halted');
    expect(
      controllerAttention({
        connection: { kind: 'disconnected' },
        safetyNotice: null,
        statusReport: null,
        alarmCode: 1,
      }),
    ).toBeNull();
  });

  it('shows the state beside Connected', () => {
    const host = render(
      <ConnectionBar
        machineName="Laser"
        connection={connected}
        machineNoun="laser"
        onConnect={noop}
        onDisconnect={noop}
        onForget={noop}
        disabled={false}
        controllerAttention="alarm"
      />,
    );
    expect(host.querySelector('.lf-connection-status-live')?.textContent).toBe('Connected · Alarm');
  });
});

describe('Use detected keeps the answering baud (U5-P3-7)', () => {
  it('lists no baud change when the controller answered at the kept speed', () => {
    const draft = {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'grbl-v1.1' as const,
      baudRate: 115200,
    };
    const reset = controllerSelectionChanges(draft, 'marlin');
    expect(reset.map((change) => change.label)).toContain('Baud rate');
    const kept = controllerSelectionChanges(draft, 'marlin', 115200);
    expect(kept.map((change) => change.label)).not.toContain('Baud rate');
  });
});

describe('a second refused setting while nothing runs (U5-P3-13)', () => {
  it('replaces the first notice with the newer refusal', () => {
    const { refs, set, get } = makeLineHandlerHarness();
    set({ pendingUntrackedAcks: 1 });
    handleLine(set, get, refs, async () => undefined, 'error:17');
    const first = get().safetyNotice;
    expect(first?.kind).toBe('controller-error');
    set({ pendingUntrackedAcks: 1 });
    handleLine(set, get, refs, async () => undefined, 'error:7');
    const second = get().safetyNotice;
    expect(second).not.toBe(first);
    expect(second?.kind === 'controller-error' ? second.code : null).toBe(7);
  });
});
