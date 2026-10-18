import { afterEach, describe, expect, it, vi } from 'vitest';
import { framedRunControllerSnapshot, type FramedRunPermit } from './framed-run';
import type { LiveRefs } from './laser-store';
import { harness, originalProject } from './positioning-light.test-support';
import { useStore } from './store';

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
  it.each(families)(
    'keeps the LED on until Off without moving or altering Frame on %s',
    async (kind) => {
      vi.useFakeTimers();
      const h = harness(kind);
      const permit = frame(h);
      const controllerBefore = h.get().statusReport;
      await h.actions.setPositioningLightEnabled(true);
      const lines = h.writes.map((line) => line.trim());
      expect(lines.indexOf(h.mapping.onCommand)).toBeGreaterThan(
        lines.indexOf(h.refs.driver.commands.frameToolOffLines[0]!),
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
      await h.actions.setPositioningLightEnabled(false);
      expect(h.get().positioningLightEnabled).toBe(false);
      expect(h.get().framedRun).toBe(permit);
      expect(h.get().completedFrame).toBe(permit);
      expect(h.writes.at(-1)?.trim()).toBe(h.mapping.offCommand);
      expect(h.writes.some(changesPosition)).toBe(false);
    },
  );

  it('turns the captured output off before enabling a changed mapping', async () => {
    const h = harness();
    await h.actions.setPositioningLightEnabled(true);
    const next = { ...h.mapping, onCommand: 'M64 P1', offCommand: 'M65 P1' };
    useStore.getState().updateDeviceProfile({ positioningLight: next });
    const start = h.writes.length;
    await h.actions.setPositioningLightEnabled(true);
    const lines = h.writes.slice(start).map((line) => line.trim());
    expect(lines.indexOf(h.mapping.offCommand)).toBeGreaterThanOrEqual(0);
    expect(lines.indexOf(h.mapping.offCommand)).toBeLessThan(lines.indexOf(next.onCommand));
    expect(lines.at(-1)).toBe(next.onCommand);
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await h.actions.setPositioningLightEnabled(false);
    expect(h.writes.at(-1)?.trim()).toBe(next.offCommand);
  });

  it('keeps the old Off mapping if its acknowledgement fails during a mapping change', async () => {
    const h = harness();
    await h.actions.setPositioningLightEnabled(true);
    useStore
      .getState()
      .updateDeviceProfile({
        positioningLight: { ...h.mapping, onCommand: 'M64 P1', offCommand: 'M65 P1' },
      });
    h.fail(h.mapping.offCommand);
    await expect(h.actions.setPositioningLightEnabled(true)).rejects.toThrow('handoff');
    expect(h.get().positioningLightEnabled).toBe(true);
    expect(h.writes).not.toContain('M64 P1\n');
    expect(h.writes.at(-1)?.trim()).toBe(h.mapping.offCommand);
  });

  it('keeps Off available when the on acknowledgement is lost', async () => {
    vi.useFakeTimers();
    const h = harness();
    const permit = frame(h);
    h.hold(h.mapping.onCommand);
    const pending = h.actions.setPositioningLightEnabled(true);
    const rejected = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(9000);
    await rejected;
    expect(h.get().positioningLightEnabled).toBe(true);
    expect(h.get().completedFrame).toBe(permit);
    expect(h.get().controllerOperation).toBeNull();
    expect(h.stop).not.toHaveBeenCalled();
    h.hold();
    useStore.getState().updateDeviceProfile({ positioningLight: undefined });
    await h.actions.setPositioningLightEnabled(false);
    expect(h.writes.at(-1)?.trim()).toBe(h.mapping.offCommand);
    expect(h.get().positioningLightEnabled).toBe(false);
  });

  it('requires fresh Idle and does not take over queued replies', async () => {
    const h = harness();
    h.set({ pendingUntrackedAcks: 1 });
    await expect(h.actions.setPositioningLightEnabled(true)).rejects.toThrow(/settle|replies/);
    expect(h.writes).toEqual([]);
    h.set({ pendingUntrackedAcks: 0 });
    h.moving(1);
    await expect(h.actions.setPositioningLightEnabled(true)).rejects.toThrow('fresh Idle');
    expect(h.writes).toEqual(['?']);
    expect(h.get().positioningLightEnabled).toBe(false);
  });

  it('rejects unsupported or mismatched profiles before sending On', async () => {
    const file = harness('ruida');
    await expect(file.actions.setPositioningLightEnabled(true)).rejects.toThrow('file export');
    expect(file.writes).toEqual([]);
    const h = harness();
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await expect(h.actions.setPositioningLightEnabled(true)).rejects.toThrow('does not match');
    expect(h.writes).toEqual([]);
  });

  it('refuses to enable an edited profile after a pending beam-off acknowledgement', async () => {
    const h = harness();
    h.hold('M5');
    const pending = h.actions.setPositioningLightEnabled(true);
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
    const pending = h.actions.setPositioningLightEnabled(true);
    const rejected = expect(pending).rejects.toThrow('session changed');
    await vi.waitFor(() => expect(h.writes).toContain('M5\n'));
    h.refs.connection = {} as LiveRefs['connection'];
    h.ack('M5');
    await rejected;
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
    const on = harness();
    await on.actions.setPositioningLightEnabled(true);
    on.refs.connection = {} as LiveRefs['connection'];
    const sent = on.writes.length;
    for (const enabled of [false, true])
      await expect(on.actions.setPositioningLightEnabled(enabled)).rejects.toThrow(
        'earlier connection',
      );
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
