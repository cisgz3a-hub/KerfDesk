import { afterEach, describe, expect, it, vi } from 'vitest';
import { framedRunControllerSnapshot, type FramedRunPermit } from './framed-run';
import type { LiveRefs } from './laser-store';
import { harness, originalProject } from '../../__fixtures__/positioning-light-harness';
import { useStore } from './store';
import {
  cancelFreshControllerStatusWait,
  waitForFreshControllerStatus,
} from './laser-controller-status-wait';
import { ControllerCommandRefusedError } from './laser-interactive-command';
import { positioningLightDisconnectOff } from './positioning-light-actions';

afterEach(() => {
  useStore.setState({ project: originalProject });
  vi.useRealTimers();
});

const families = ['grbl-v1.1', 'grblhal', 'fluidnc', 'marlin', 'smoothieware'] as const;
const changesPosition = (line: string): boolean =>
  /^(?:\$J=|\$H|G(?:0|1|10|28|54|90|91|92)(?:\s|$))/.test(line.trim());

function frame(h: ReturnType<typeof harness>): FramedRunPermit {
  const permit = {
    kind: 'ready',
    completedStatusSequence: h.get().statusSequence,
    controller: framedRunControllerSnapshot(h.get()),
    candidate: {
      preparedStart: {
        jobOrigin: { startFrom: 'current-position', currentPosition: { x: 0, y: 0 } },
      },
    },
  } as unknown as FramedRunPermit;
  h.set({ framedRun: permit, completedFrame: permit });
  return permit;
}

describe('independent positioning LED switch', () => {
  it.each(['switchPositioningLightOn', 'switchPositioningLightOff'] as const)(
    'refuses a stored macro mapping before %s takes ownership or writes',
    async (action) => {
      const h = harness('marlin');
      const project = useStore.getState().project;
      useStore.setState({
        project: {
          ...project,
          device: {
            ...project.device,
            positioningLight: { ...h.mapping, onCommand: 'M0810', offCommand: 'M819' },
          },
        },
      });
      await expect(h.actions[action]()).rejects.toThrow('stored macro');
      expect(h.writes).toEqual([]);
      expect(h.get().controllerOperation).toBeNull();
      expect(h.get().positioningLightEnabled).toBe(false);
    },
  );

  it.each(families)(
    'keeps the LED on until Off without moving or altering Frame on %s',
    async (kind) => {
      vi.useFakeTimers();
      const h = harness(kind);
      const permit = frame(h);
      const controllerBefore = h.get().statusReport;
      await h.actions.switchPositioningLightOn();
      const lines = h.writes.map((line) => line.trim());
      expect(lines.indexOf(h.mapping.onCommand)).toBeGreaterThan(
        lines.indexOf(h.refs.driver.commands.frameToolOffLines[0]!),
      );
      expect(lines).not.toContain('M9');
      expect(lines).not.toContain('M107');
      expect(lines).toEqual(
        expect.arrayContaining(
          h.refs.driver.commands.frameToolOffLines.filter(
            (line) => line !== 'M9' && line !== 'M107',
          ),
        ),
      );
      expect(lines.at(-1)).toBe(h.mapping.onCommand);
      expect(lines).toContain(h.refs.driver.commands.settleDwell);
      expect(lines.some(changesPosition)).toBe(false);
      expect(h.get().statusReport).toEqual(controllerBefore);
      expect(h.get().controllerOperation).toBeNull();
      expect(h.get().framedRun).toBe(permit);
      expect(h.get().completedFrame).toBe(permit);
      const sent = h.writes.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.get().positioningLightEnabled).toBe(true);
      expect(h.writes).toHaveLength(sent);
      await h.actions.switchPositioningLightOff();
      expect(h.get().positioningLightEnabled).toBe(false);
      expect(h.get().framedRun).toBe(permit);
      expect(h.get().completedFrame).toBe(permit);
      expect(h.writes.at(-1)?.trim()).toBe(h.mapping.offCommand);
      expect(h.writes.some(changesPosition)).toBe(false);
    },
  );

  it('still sends M9 when it is the explicitly configured LED output Off', async () => {
    const h = harness();
    useStore.getState().updateDeviceProfile({
      positioningLight: { ...h.mapping, onCommand: 'M7', offCommand: 'M9' },
    });
    await h.actions.switchPositioningLightOn();
    expect(h.writes.filter((line) => line.trim() === 'M9')).toHaveLength(1);
    expect(h.writes.at(-1)?.trim()).toBe('M7');
    expect(h.writes.some(changesPosition)).toBe(false);
    await h.actions.switchPositioningLightOff();
    expect(h.writes.filter((line) => line.trim() === 'M9')).toHaveLength(2);
    expect(h.get().positioningLightEnabled).toBe(false);
  });

  it('leaves an incumbent readiness wait untouched when switching On', async () => {
    const h = harness();
    const waiting = waitForFreshControllerStatus(h.refs, {
      after: { sessionEpoch: h.get().controllerSessionEpoch, sequence: h.get().statusSequence },
      accept: () => true,
      timeoutMs: 1_000,
      timeoutMessage: 'Incumbent timed out',
    }).catch(() => undefined);
    const owner = h.refs.controllerStatusWait;
    try {
      await expect(h.actions.switchPositioningLightOn()).rejects.toThrow(
        'current controller command',
      );
      expect(h.refs.controllerStatusWait).toBe(owner);
      expect(h.get().controllerOperation).toBeNull();
      expect(h.writes).toEqual([]);
    } finally {
      cancelFreshControllerStatusWait(h.refs);
      await waiting;
    }
  });

  it('sends no captured Off after the profile changes to a fan-mosfet laser during its status wait', async () => {
    const h = harness('marlin');
    await h.actions.switchPositioningLightOn();
    const start = h.writes.length;
    h.after((line) => {
      if (line === 'M114')
        useStore.getState().updateDeviceProfile({ gcodeDialect: { dialectId: 'marlin-fan' } });
    });
    await expect(h.actions.switchPositioningLightOff()).rejects.toThrow('fan-mosfet');
    expect(h.writes.slice(start)).toEqual(['M114\n']);
    expect(h.get().positioningLightEnabled).toBe(true);
    expect(h.get().controllerOperation).toBeNull();
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('turns the captured output off before enabling a changed mapping', async () => {
    const h = harness();
    await h.actions.switchPositioningLightOn();
    const next = { ...h.mapping, onCommand: 'M64 P1', offCommand: 'M65 P1' };
    useStore.getState().updateDeviceProfile({ positioningLight: next });
    const start = h.writes.length;
    await h.actions.switchPositioningLightOn();
    const lines = h.writes.slice(start).map((line) => line.trim());
    expect(lines.indexOf(h.mapping.offCommand)).toBeGreaterThanOrEqual(0);
    expect(lines.indexOf(h.mapping.offCommand)).toBeLessThan(lines.indexOf(next.onCommand));
    expect(lines.at(-1)).toBe(next.onCommand);
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await h.actions.switchPositioningLightOff();
    expect(h.writes.at(-1)?.trim()).toBe(next.offCommand);
  });

  it('keeps the old Off mapping if its acknowledgement fails during a mapping change', async () => {
    const h = harness();
    await h.actions.switchPositioningLightOn();
    useStore.getState().updateDeviceProfile({
      positioningLight: { ...h.mapping, onCommand: 'M64 P1', offCommand: 'M65 P1' },
    });
    h.fail(h.mapping.offCommand);
    await expect(h.actions.switchPositioningLightOn()).rejects.toThrow('handoff');
    expect(h.get().positioningLightEnabled).toBe(true);
    expect(h.writes).not.toContain('M64 P1\n');
    expect(h.writes.at(-1)?.trim()).toBe(h.mapping.offCommand);
  });

  it.each(['grbl-v1.1', 'grblhal', 'fluidnc'] as const)(
    'clears On tracking for unsupported On on %s',
    async (kind) => {
      const h = harness(kind);
      h.refuse(h.mapping.onCommand);
      await expect(h.actions.switchPositioningLightOn()).rejects.toBeInstanceOf(
        ControllerCommandRefusedError,
      );
      const lines = h.writes.map((line) => line.trim());
      expect(lines.indexOf(h.mapping.offCommand)).toBeLessThan(lines.indexOf(h.mapping.onCommand));
      expect(h.get().positioningLightEnabled).toBe(false);
      expect(positioningLightDisconnectOff(h.get(), h.refs)).toBeNull();
      expect(h.get().controllerOperation).toBeNull();
      h.refuse();
      await h.actions.switchPositioningLightOn();
      expect(h.get().positioningLightEnabled).toBe(true);
    },
  );

  it.each([
    ['grbl-v1.1', 'error:20ok'],
    ['grbl-v1.1', 'error:7002009'],
    ['grbl-v1.1', 'error:7'],
    ['marlin', 'Error:handler failed'],
    ['marlin', 'Error:Printer halted. kill() called!'],
    ['marlin', 'unknown-command'],
    ['smoothieware', 'error:unsupported pin'],
    ['smoothieware', '!!'],
  ] as const)('keeps conservative On and its captured Off for %s %s', async (kind, response) => {
    const h = harness(kind);
    h.refuse(
      h.mapping.onCommand,
      response === 'unknown-command' ? `echo:Unknown command: "${h.mapping.onCommand}"` : response,
    );
    await expect(h.actions.switchPositioningLightOn()).rejects.toBeInstanceOf(
      ControllerCommandRefusedError,
    );
    expect(h.get().positioningLightEnabled).toBe(true);
    expect(positioningLightDisconnectOff(h.get(), h.refs)?.trim()).toBe(h.mapping.offCommand);
    expect(h.get().controllerOperation).toBeNull();
    h.refuse();
    await h.actions.switchPositioningLightOff();
    expect(h.get().positioningLightEnabled).toBe(false);
    expect(positioningLightDisconnectOff(h.get(), h.refs)).toBeNull();
  });
  it('keeps Off available when the on acknowledgement is lost', async () => {
    vi.useFakeTimers();
    const h = harness();
    const permit = frame(h);
    h.hold(h.mapping.onCommand);
    const pending = h.actions.switchPositioningLightOn();
    const rejected = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(9000);
    await rejected;
    expect(h.get().positioningLightEnabled).toBe(true);
    expect(h.get().completedFrame).toBe(permit);
    expect(h.get().controllerOperation).toBeNull();
    expect(h.stop).not.toHaveBeenCalled();
    h.hold();
    useStore.getState().updateDeviceProfile({ positioningLight: undefined });
    await h.actions.switchPositioningLightOff();
    expect(h.writes.at(-1)?.trim()).toBe(h.mapping.offCommand);
    expect(h.get().positioningLightEnabled).toBe(false);
  });

  it('requires fresh Idle and does not take over queued replies', async () => {
    const h = harness();
    h.set({ pendingUntrackedAcks: 1 });
    await expect(h.actions.switchPositioningLightOn()).rejects.toThrow(/settle|replies/);
    expect(h.writes).toEqual([]);
    h.set({ pendingUntrackedAcks: 0 });
    h.moving(1);
    await expect(h.actions.switchPositioningLightOn()).rejects.toThrow('fresh Idle');
    expect(h.writes).toEqual(['?']);
    expect(h.get().positioningLightEnabled).toBe(false);
  });

  it('rejects unsupported or mismatched profiles before sending On', async () => {
    const file = harness('ruida');
    await expect(file.actions.switchPositioningLightOn()).rejects.toThrow('file export');
    expect(file.writes).toEqual([]);
    const h = harness();
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await expect(h.actions.switchPositioningLightOn()).rejects.toThrow('does not match');
    expect(h.writes).toEqual([]);
  });

  it('refuses to enable an edited profile after a pending beam-off acknowledgement', async () => {
    const h = harness();
    h.hold('M5');
    const pending = h.actions.switchPositioningLightOn();
    const rejected = expect(pending).rejects.toThrow('Device settings changed');
    await vi.waitFor(() => expect(h.writes).toContain('M5\n'));
    useStore
      .getState()
      .updateDeviceProfile({ positioningLight: { ...h.mapping, onCommand: 'M64 P1' } });
    h.ack('M5');
    await rejected;
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
    expect(h.writes).not.toContain('M64 P1\n');
    expect(h.get().positioningLightEnabled).toBe(false);
    expect(h.get().controllerOperation).toBeNull();
  });

  it('never continues On or reuses a captured Off across controller sessions', async () => {
    const h = harness();
    h.hold('M5');
    const pending = h.actions.switchPositioningLightOn();
    const rejected = expect(pending).rejects.toThrow('session changed');
    await vi.waitFor(() => expect(h.writes).toContain('M5\n'));
    h.refs.connection = {} as LiveRefs['connection'];
    h.ack('M5');
    await rejected;
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
    const on = harness();
    await on.actions.switchPositioningLightOn();
    on.refs.connection = {} as LiveRefs['connection'];
    const sent = on.writes.length;
    for (const action of [
      on.actions.switchPositioningLightOff,
      on.actions.switchPositioningLightOn,
    ])
      await expect(action()).rejects.toThrow('earlier connection');
    expect(on.writes).toHaveLength(sent);
  });

  it('checks a chosen artwork target again after the pre-motion fence', async () => {
    const h = harness();
    let current = true;
    const permit = frame(h);
    h.hold(h.refs.driver.commands.settleDwell);
    const pending = h.actions.centrePositioningLight(40, 45, 1200, () => {
      if (!current) throw new Error('Chosen artwork changed');
    });
    const rejected = expect(pending).rejects.toThrow('Chosen artwork changed');
    await vi.waitFor(() => expect(h.writes).toContain(`${h.refs.driver.commands.settleDwell}\n`));
    current = false;
    h.ack(h.refs.driver.commands.settleDwell);
    await rejected;
    expect(h.hasMoved()).toBe(false);
    expect(h.get().completedFrame).toBe(permit);
    expect(h.get().positioningLightEnabled).toBe(false);
    expect(h.get().controllerOperation).toBeNull();
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
  });
});
