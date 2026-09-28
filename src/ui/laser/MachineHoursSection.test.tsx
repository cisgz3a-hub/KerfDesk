/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentHoursMachine, useMachineHoursTracking } from '../app/use-machine-hours-tracking';
import { useStore } from '../state';
import type { LiveCanvasLifecycle, LiveCanvasRun } from '../state/canvas-motion-plan';
import { useLaserStore } from '../state/laser-store';
import { HOUR_MS } from '../state/machine-hours';
import { useMachineHoursStore } from '../state/machine-hours-store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { MachineHoursSection } from './MachineHoursSection';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  localStorage.clear();
  useMachineHoursStore.getState().reload();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  useLaserStore.setState({ liveCanvasRun: null });
  vi.useRealTimers();
});

describe('MachineHoursSection (ADR-502)', () => {
  it("shows this machine's hours and its reminders, and Done restarts one", async () => {
    const machine = currentHoursMachine();
    useMachineHoursStore.getState().addRun(machine, 21 * HOUR_MS, true);
    await act(async () => root.render(<MachineHoursSection />));

    expect(host.querySelector('summary')?.textContent).toBe('Machine hours · 1 due');
    expect(host.textContent).toContain('21 h over 1 job on Default 400×400.');
    expect(host.textContent).toContain('Clean the lens and its window · due now, 1.0 h over');
    expect(host.textContent).toContain('Check the belts, wheels and rails · due in 79 h');

    await act(async () => button('Mark done: Clean the lens and its window').click());

    expect(host.querySelector('summary')?.textContent).toBe('Machine hours');
    expect(host.textContent).toContain('Clean the lens and its window · due in 20 h');
  });

  it('edits, adds and removes reminders, and keeps them for the next session', async () => {
    await act(async () => root.render(<MachineHoursSection />));
    const every = input('Hours between: Clean the lens and its window');
    await act(async () => {
      every.value = '8';
      Simulate.blur(every);
    });
    await act(async () => {
      const label = input('New reminder');
      label.value = 'Replace the honeycomb';
      Simulate.change(label);
    });
    await act(async () => button('Add').click());
    await act(async () => button('Remove reminder: Check the belts, wheels and rails').click());

    useMachineHoursStore.getState().reload();
    const reminders =
      useMachineHoursStore.getState().book[currentHoursMachine().signature]?.reminders;
    expect(reminders?.map((reminder) => [reminder.label, reminder.everyHours])).toEqual([
      ['Clean the lens and its window', 8],
      ['Clear the air-assist nozzle and check the fans', 50],
      ['Replace the honeycomb', 50],
    ]);
  });

  it('counts a job while it runs and says when a reminder falls due', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const machine = currentHoursMachine();
    useMachineHoursStore.getState().addRun(machine, 20 * HOUR_MS - 30_000, false);
    function Tracker(): null {
      useMachineHoursTracking();
      return null;
    }
    await act(async () => root.render(<Tracker />));
    const plan = {} as LiveCanvasRun['plan'];
    const setRun = (lifecycle: LiveCanvasLifecycle) =>
      useLaserStore.setState({
        liveCanvasRun: { plan, startedAtMs: 0, lifecycle } as unknown as LiveCanvasRun,
      });
    const toasts = useToastStore.getState().toasts.length;

    setRun('running');
    vi.setSystemTime(20_000);
    setRun('paused');
    vi.setSystemTime(600_000);
    setRun('running');
    vi.setSystemTime(640_000);
    // The project changes machine mid-job: the time still goes to the machine it started on.
    useStore
      .getState()
      .replaceDeviceProfile({ ...useStore.getState().project.device, name: 'Other' });
    setRun('finished');

    const record = useMachineHoursStore.getState().book[machine.signature];
    expect(record).toMatchObject({ runMs: 20 * HOUR_MS - 30_000 + 60_000, jobs: 1 });
    expect(
      useToastStore
        .getState()
        .toasts.slice(toasts)
        .map((toast) => toast.message),
    ).toEqual([
      'Maintenance due on Default 400×400: Clean the lens and its window. Mark it done under Machine hours.',
    ]);
  });
});

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (element) => element.getAttribute('aria-label') === label || element.textContent === label,
  );
  if (found === undefined) throw new Error(`${label} missing`);
  return found;
}

function input(label: string): HTMLInputElement {
  const found = host.querySelector(`input[aria-label="${label}"]`);
  if (!(found instanceof HTMLInputElement)) throw new Error(`${label} missing`);
  return found;
}
