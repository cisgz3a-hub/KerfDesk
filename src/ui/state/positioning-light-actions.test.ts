import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControllerKind } from '../../core/devices/device-profile';
import { disconnectStopCommands } from './laser-store-helpers';
import { cancelControllerLifecycleRefs } from './laser-interactive-command';
import { positioningLightDisconnectOff } from './positioning-light-actions';
import {
  framedRunControllerSnapshot,
  framedRunStartHandoffIssue,
  type FramedRunPermit,
} from './framed-run';
import { type LiveRefs } from './laser-store';
import { useStore } from './store';
import { harness, originalProject } from '../../__fixtures__/positioning-light-harness';

afterEach(() => {
  useStore.setState({ project: originalProject });
  vi.useRealTimers();
});

const families: ControllerKind[] = ['grbl-v1.1', 'grblhal', 'fluidnc', 'marlin', 'smoothieware'];
describe('separate positioning light transaction', () => {
  it.each(families)(
    'owns beam-off travel, planner settlement, fresh position and light ACK on %s',
    async (kind) => {
      const h = harness(kind);
      await h.actions.centrePositioningLight(40.004, 45.006, 1200);
      const lines = h.writes
        .flatMap((wire) => wire.split('\n').map((line) => line.trim()))
        .filter((line) => line !== '');
      const move = lines.findIndex(
        (line) => line.startsWith('$J=') || line.startsWith('G0 ') || line.startsWith('G1 '),
      );
      expect(move).toBeGreaterThan(lines.indexOf(h.refs.driver.commands.frameToolOffLines[0]!));
      const on = lines.indexOf(h.mapping.onCommand);
      expect(on).toBeGreaterThan(move);
      expect(lines.slice(move + 1, on)).toContain(h.refs.driver.commands.settleDwell);
      expect(lines[on - 1]).toBe(kind === 'marlin' ? 'M114' : '?');
      expect(h.get().controllerOperation).toBeNull();
      expect(h.get().positioningLightEnabled).toBe(true);
      await h.actions.switchPositioningLightOff();
      expect(h.get().positioningLightEnabled).toBe(false);
      expect(h.writes.at(-1)?.trim()).toBe(h.mapping.offCommand);
    },
  );

  it('queues a Marlin G91/G0/G90 light move as one owned write', async () => {
    const h = harness('marlin');
    await h.actions.centrePositioningLight(20, 10, 1200);
    const jog = h.writes.find((wire) => wire.includes('G91'));
    // The whole relative move, including the return to G90, is one wire write,
    // so an Abort can never land between G91 and G90 and leave G91 modal.
    expect(jog).toBeDefined();
    expect(jog).toMatch(/G91[^\n]*\n[^\n]*G0 [^\n]*\n[^\n]*G90\n$/);
    expect(h.writes.filter((wire) => /\bG9[01]\b/.test(wire))).toEqual([jog]);
  });

  it('contains an Abort during a Marlin light move without a lone G91 on the wire', async () => {
    const h = harness('marlin');
    h.hold('G90');
    const centring = h.actions.centrePositioningLight(20, 10, 1200);
    await vi.waitFor(() => expect(h.writes.some((wire) => wire.includes('G91'))).toBe(true));
    cancelControllerLifecycleRefs(h.refs, 'Abort');
    await expect(centring).rejects.toThrow();
    const jog = h.writes.find((wire) => wire.includes('G91'));
    expect(jog).toContain('G90');
    expect(h.stop).toHaveBeenCalled();
  });

  it('uses the Falcon beam-off G1 command contract without native jog bytes', async () => {
    const h = harness('grbl-v1.1', 'creality-falcon-a1-pro');
    await h.actions.centrePositioningLight(40, 45, 1200);
    expect(h.writes.join('')).toContain('G1 X40.000 Y45.000 F1200 S0\n');
    expect(h.writes.some((line) => line.startsWith('$J='))).toBe(false);
    expect(h.get().positioningLightEnabled).toBe(true);
  });

  it('waits out native Jog before sending its ordinary G4 fence', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.after((line) => {
      if (line.startsWith('$J=')) h.moving(3);
    });
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    await vi.advanceTimersByTimeAsync(150);
    expect(h.hasMoved()).toBe(true);
    expect(h.writes.filter((line) => line.startsWith('G4'))).toHaveLength(1);
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(h.writes.filter((line) => line.startsWith('G4'))).toHaveLength(2);
  });

  it('requires final marker acknowledgement despite fresh Idle', async () => {
    const h = harness();
    let markers = 0;
    h.after((line) => {
      if (line.startsWith('G4') && ++markers === 2) h.hold(line);
    });
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    await vi.waitFor(() => expect(markers).toBe(2));
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
    h.hold();
    h.ack(h.refs.driver.commands.settleDwell);
    await pending;
  });

  it('keeps Off available after an uncertain on handoff and uses its captured mapping after profile changes', async () => {
    const h = harness();
    h.fail(h.mapping.onCommand);
    await expect(h.actions.centrePositioningLight(40, 45, 1200)).rejects.toThrow('handoff');
    expect(h.get().positioningLightEnabled).toBe(true);
    useStore.setState({
      project: { ...useStore.getState().project, device: { ...originalProject.device } },
    });
    await h.actions.switchPositioningLightOff();
    expect(h.writes.at(-1)?.trim()).toBe(h.mapping.offCommand);
    expect(h.get().positioningLightEnabled).toBe(false);
  });

  it('contains an uncertain motion even while the last cached report still says Idle', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.after((line) => {
      if (line.startsWith('$J=')) h.hold(line);
    });
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    const failure = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(9000);
    await failure;
    expect(h.stop).toHaveBeenCalledOnce();
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
  });

  it('releases a refused jog without the reset-based Abort', async () => {
    const h = harness();
    h.after((line) => {
      if (line.startsWith('$J=')) h.hold(line);
    });
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    const failure = expect(pending).rejects.toThrow('error:15');
    await vi.waitFor(() => expect(h.writes.some((line) => line.startsWith('$J='))).toBe(true));
    consumeControllerCommandResponse(h.refs, h.refs.driver.classifyLine('error:15'), 'error:15');
    await failure;
    expect(h.stop).not.toHaveBeenCalled();
    expect(h.get().controllerOperation).toBeNull();
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
  });

  it('hands a reported Jog to the unowned jog-cancel Abort after a status timeout', async () => {
    vi.useFakeTimers();
    const h = harness();
    let jogged = false;
    let polls = 0;
    h.after((line) => {
      if (line.startsWith('$J=')) {
        jogged = true;
        h.moving(100);
      } else if (line === '?' && jogged && ++polls === 2) h.hold('?');
    });
    let ownerAtAbort: unknown = 'not called';
    h.set({
      stopJob: async () => {
        ownerAtAbort = h.get().controllerOperation;
      },
    });
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    const failure = expect(pending).rejects.toThrow(/timed out|position/);
    await vi.advanceTimersByTimeAsync(9000);
    await failure;
    expect(h.get().statusReport?.state).toBe('Jog');
    expect(ownerAtAbort).toBeNull();
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
  });

  it('exposes the captured off command to Disconnect only while lit on this connection', async () => {
    const h = harness();
    expect(positioningLightDisconnectOff(h.get(), h.refs)).toBeNull();
    await h.actions.centrePositioningLight(40, 45, 1200);
    expect(positioningLightDisconnectOff(h.get(), h.refs)).toBe(h.mapping.offCommand);
    const original = h.refs.connection;
    h.refs.connection = {} as LiveRefs['connection'];
    expect(positioningLightDisconnectOff(h.get(), h.refs)).toBeNull();
    h.refs.connection = original;
    await h.actions.switchPositioningLightOff();
    expect(positioningLightDisconnectOff(h.get(), h.refs)).toBeNull();
  });

  it('never continues into a replacement session after a pending acknowledgement', async () => {
    const h = harness();
    h.hold('M5');
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    const failure = expect(pending).rejects.toThrow(/session changed/);
    await vi.waitFor(() => expect(h.writes).toContain('M5\n'));
    h.refs.connection = {} as LiveRefs['connection'];
    h.ack('M5');
    await failure;
    expect(h.hasMoved()).toBe(false);
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
  });

  it('preserves a replacement controller operation when failure cleanup finishes', async () => {
    const h = harness('marlin');
    const replacement = {
      kind: 'interactive-command' as const,
      phase: 'command' as const,
      label: 'New controller operation',
    };
    h.fail('G0 X40.000 Y45.000 F1200');
    h.set({
      stopJob: async () => {
        h.set({ controllerOperation: replacement });
      },
    });
    await expect(h.actions.centrePositioningLight(40, 45, 1200)).rejects.toThrow('handoff');
    expect(h.get().controllerOperation).toBe(replacement);
  });

  it('reserves motion ownership for Disconnect before any travel', async () => {
    const h = harness();
    h.hold('M5');
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    const failure = expect(pending).rejects.toThrow(/cancelled/);
    await vi.waitFor(() => expect(h.writes).toContain('M5\n'));
    expect(disconnectStopCommands(h.get(), h.refs.driver)).toContain('\x18');
    cancelControllerLifecycleRefs(h.refs);
    await failure;
  });

  it('cancels a timed-out queued Marlin query before releasing the operation', async () => {
    vi.useFakeTimers();
    const h = harness('marlin');
    h.hold('M114');
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    const failure = expect(pending).rejects.toThrow(/position|handoff/);
    await vi.advanceTimersByTimeAsync(3100);
    await failure;
    expect(h.refs.controllerCommand).toBeNull();
    expect(h.get().controllerOperation).toBeNull();
    expect(h.hasMoved()).toBe(false);
  });

  it('rejects an Off fallback from a different profile family without writing', async () => {
    const h = harness();
    useStore.getState().updateDeviceProfile({
      controllerKind: 'marlin',
      positioningLight: { ...h.mapping, offCommand: 'M355 S0' },
    });
    await expect(h.actions.switchPositioningLightOff()).rejects.toThrow('does not match');
    expect(h.writes).toEqual([]);
  });

  it('turns off the captured light even after a different controller profile is selected', async () => {
    const h = harness();
    await h.actions.centrePositioningLight(40, 45, 1200);
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await h.actions.switchPositioningLightOff();
    expect(h.writes.at(-1)?.trim()).toBe(h.mapping.offCommand);
  });

  it.each([
    ['marlin', 'M355 S1', 'M0355 S1'],
    ['fluidnc', 'M64 P0', 'M65 P1'],
    ['marlin', 'M125', 'M355 S0'],
  ] as const)(
    'rejects invalid %s light mapping before any controller write',
    async (kind, onCommand, offCommand) => {
      const h = harness(kind);
      useStore.setState((state) => ({
        project: {
          ...state.project,
          device: {
            ...state.project.device,
            positioningLight: { ...h.mapping, onCommand, offCommand },
          },
        },
      }));
      await expect(h.actions.centrePositioningLight(40, 45, 1200)).rejects.toThrow(
        /Positioning light/,
      );
      expect(h.writes).toEqual([]);
      expect(h.hasMoved()).toBe(false);
      expect(h.get().controllerOperation).toBeNull();
    },
  );

  it('rejects file-only controllers and invalid maps without any command', async () => {
    const h = harness('ruida');
    await expect(h.actions.centrePositioningLight(40, 45, 1200)).rejects.toThrow('file export');
    expect(h.writes).toEqual([]);
    const g = harness();
    useStore.setState({
      project: {
        ...useStore.getState().project,
        device: {
          ...originalProject.device,
          positioningLight: { ...g.mapping, onCommand: 'M3 S1' },
        },
      },
    });
    await expect(g.actions.centrePositioningLight(40, 45, 1200)).rejects.toThrow(/accessory/);
    expect(g.writes).toEqual([]);
  });
});

describe('Frame evidence across a positioning-light move (ADR-604)', () => {
  type Harness = ReturnType<typeof harness>;
  function completeFrame(h: Harness, startFrom: 'absolute' | 'current-position'): FramedRunPermit {
    const permit = {
      kind: 'ready',
      completedStatusSequence: h.get().statusSequence,
      controller: framedRunControllerSnapshot(h.get()),
      candidate: { preparedStart: { jobOrigin: { startFrom } } },
    } as unknown as FramedRunPermit;
    const frameVerification = { boundsSignature: 'b', wco: null, workOriginActive: false };
    h.set({ framedRun: permit, completedFrame: permit, frameVerification });
    return permit;
  }
  const isTravel = (line: string): boolean => line.startsWith('$J=') || line.startsWith('G1 ');

  it('keeps an Absolute Frame and observes the verified light position', async () => {
    const h = harness();
    const permit = completeFrame(h, 'absolute');
    await h.actions.centrePositioningLight(40, 45, 1200);
    const kept = h.get().completedFrame!;
    expect(kept).not.toBe(permit);
    expect(kept.candidate).toBe(permit.candidate);
    expect(kept.controller.statusReport?.mPos).toMatchObject({ x: 40, y: 45 });
    expect(h.get().framedRun).toBe(kept);
    expect(framedRunStartHandoffIssue(kept, h.get())).toBeNull();
    expect(framedRunStartHandoffIssue(permit, h.get())).not.toBeNull();
    expect(h.get().frameVerification).not.toBeNull();
    expect(h.get().positioningLightEnabled).toBe(true);
  });

  it('voids a Current Position Frame, whose placement follows the head', async () => {
    const h = harness();
    completeFrame(h, 'current-position');
    await h.actions.centrePositioningLight(40, 45, 1200);
    expect(h.get().completedFrame).toBeNull();
    expect(h.get().framedRun).toBeNull();
  });

  it('voids the Frame when the canvas changes during the move, even if changed back', async () => {
    const h = harness();
    completeFrame(h, 'absolute');
    const project = useStore.getState().project;
    h.after((line) => {
      if (!isTravel(line)) return;
      useStore.setState({ project: { ...project } });
    });
    await h.actions.centrePositioningLight(40, 45, 1200);
    expect(h.get().completedFrame).toBeNull();
    expect(h.get().framedRun).toBeNull();
  });

  it('voids the Frame when the light travel fails', async () => {
    const h = harness();
    completeFrame(h, 'absolute');
    h.after((line) => {
      if (isTravel(line)) h.fail(line);
    });
    await expect(h.actions.centrePositioningLight(40, 45, 1200)).rejects.toThrow();
    expect(h.get().completedFrame).toBeNull();
    expect(h.get().framedRun).toBeNull();
  });
});
