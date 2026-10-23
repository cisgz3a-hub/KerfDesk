import { afterEach, describe, expect, it, vi } from 'vitest';
import { RT_SPINDLE_OV_RESET } from '../../core/controllers/grbl';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { FALCON_A1_PRO_INFRARED_2W_MODULE } from '../../core/devices/laser-modules';
import { LASER_DOT_LIGHT, type LaserDotLight } from '../../core/devices/positioning-light';
import { harness, originalProject } from '../../__fixtures__/positioning-light-harness';
import { fireActions } from './laser-fire-actions';
import { FIRE_ACTIVE_COMMAND_MESSAGE, jogFrameCommandBlockMessage } from './laser-store-helpers';
import { laserDotLit, withoutLaserDotLatch } from './laser-dot-light';
import { positioningLightDisconnectOff } from './positioning-light-actions';
import { useStore } from './store';

afterEach(() => {
  vi.useRealTimers();
  useStore.setState({ project: originalProject });
});

// The A1 Pro profile: S1000, Frame feed 10000 mm/min, approved for low-power Fire.
const DOT_ON = 'G1 F10000 M3 S10';

function dotHarness(light: LaserDotLight = LASER_DOT_LIGHT) {
  const h = harness('grblhal', 'creality-falcon-a1-pro');
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: {
        ...project.device,
        ...FALCON_A1_PRO_GRBLHAL_PROFILE,
        controllerKind: 'grblhal',
        positioningLight: light,
      },
    },
  });
  const lines = () =>
    h.writes.flatMap((wire) => wire.split('\n').map((line) => line.trim())).filter(Boolean);
  return { ...h, lines };
}

describe('Falcon A1 Pro laser dot through the LED controls (ADR-664)', () => {
  it('LED on lights the laser at the capped power after M5, with power at 100%', async () => {
    const h = dotHarness();
    await h.actions.switchPositioningLightOn();
    const lines = h.lines();
    expect(lines.at(-1)).toBe(DOT_ON);
    expect(lines.indexOf('M5')).toBeGreaterThan(-1);
    expect(lines.indexOf('M5')).toBeLessThan(lines.indexOf(DOT_ON));
    // The power override goes back to 100% on its own write, just before the dot.
    expect(lines.at(-2)).toBe(RT_SPINDLE_OV_RESET);
    expect(lines.some((line) => /^M6[45]|^M355/.test(line))).toBe(false);
    expect(h.get()).toMatchObject({
      positioningLightEnabled: true,
      fireActive: true,
      controllerOperation: null,
    });
    expect(laserDotLit(h.get())).toBe(true);
    // Disconnect's Fire cleanup sends the M5; the light adds no second line.
    expect(positioningLightDisconnectOff(h.get(), h.refs)).toBeNull();
  });

  it('LED off sends M5 and drops the Fire latch', async () => {
    const h = dotHarness();
    await h.actions.switchPositioningLightOn();
    await h.actions.switchPositioningLightOff();
    expect(h.lines().at(-1)).toBe('M5');
    expect(h.get()).toMatchObject({ positioningLightEnabled: false, fireActive: false });
  });

  it('keeps the power cap: 5% is the most the dot ever asks for', async () => {
    const h = dotHarness({ ...LASER_DOT_LIGHT, powerPercent: 5 });
    await h.actions.switchPositioningLightOn();
    expect(h.lines().at(-1)).toBe('G1 F10000 M3 S50');
  });

  it('Centre & LED moves with the beam off, then lights the dot', async () => {
    const h = dotHarness();
    await h.actions.centrePositioningLight(40, 45, 1200);
    const lines = h.lines();
    const move = lines.findIndex((line) => line.includes('X40.000') && line.includes('Y45.000'));
    expect(move).toBeGreaterThan(-1);
    expect(lines.indexOf('M5')).toBeLessThan(move);
    expect(lines.indexOf(DOT_ON)).toBeGreaterThan(move);
    expect(h.get().fireActive).toBe(true);
  });

  it('refuses jog and Frame while lit, but not its own LED off or a new centre', async () => {
    const h = dotHarness();
    await h.actions.switchPositioningLightOn();
    expect(jogFrameCommandBlockMessage(h.get())).toBe(FIRE_ACTIVE_COMMAND_MESSAGE);
    expect(jogFrameCommandBlockMessage(withoutLaserDotLatch(h.get()))).toBeNull();
    await h.actions.centrePositioningLight(10, 0, 1200);
    const lines = h.lines();
    const relit = lines.lastIndexOf(DOT_ON);
    // The dot went out before the head moved and only came back at the target.
    const lastOff = lines.lastIndexOf('M5');
    const move = lines.findIndex((line, index) => index > lastOff && line.includes('X10.000'));
    expect(lastOff).toBeLessThan(move);
    expect(relit).toBeGreaterThan(move);
  });

  it('goes off by itself after 30 s, as Creality’s “Laser on” does', async () => {
    vi.useFakeTimers();
    const h = dotHarness();
    await h.actions.switchPositioningLightOn();
    const sent = h.writes.length;
    await vi.advanceTimersByTimeAsync(29_000);
    expect(h.writes).toHaveLength(sent);
    expect(h.get().fireActive).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(h.get().fireActive).toBe(false));
    expect(h.lines().at(-1)).toBe('M5');
    expect(h.get().positioningLightEnabled).toBe(false);
    expect(h.get().log.at(-1)).toContain('Laser dot off after 30 s');
  });

  it('a dot switched off and on again restarts its 30 s', async () => {
    vi.useFakeTimers();
    const h = dotHarness();
    await h.actions.switchPositioningLightOn();
    await vi.advanceTimersByTimeAsync(20_000);
    await h.actions.switchPositioningLightOn();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.get().fireActive).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(h.get().fireActive).toBe(false));
  });

  it('a GRBL refusal of the on line leaves the dot recorded off', async () => {
    const h = dotHarness();
    h.refuse(DOT_ON, 'error:22');
    await expect(h.actions.switchPositioningLightOn()).rejects.toThrow();
    expect(h.get()).toMatchObject({ positioningLightEnabled: false, fireActive: false });
  });

  it('a lost on line keeps the Fire latch and its 30 s off, so LASER OFF stays offered', async () => {
    vi.useFakeTimers();
    const h = dotHarness();
    h.fail(DOT_ON);
    await expect(h.actions.switchPositioningLightOn()).rejects.toThrow('wire handoff failed');
    expect(h.get()).toMatchObject({ fireActive: true, controllerOperation: null });
    h.fail('');
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(h.get().fireActive).toBe(false));
    expect(h.lines().at(-1)).toBe('M5');
  });

  it('retries after both automatic off paths fail, keeping LASER OFF offered', async () => {
    vi.useFakeTimers();
    const h = dotHarness();
    const fallback = vi.fn(async () => {
      throw new Error('link unavailable');
    });
    h.set({ setFireActive: fallback });
    await h.actions.switchPositioningLightOn();
    h.fail('M5');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fallback).toHaveBeenCalledOnce();
    expect(h.get()).toMatchObject({ fireActive: true, positioningLightEnabled: true });
    h.fail('');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.get()).toMatchObject({ fireActive: false, positioningLightEnabled: false });
    expect(h.lines().at(-1)).toBe('M5');
  });

  it('does not send a fallback off into a replacement controller session', async () => {
    vi.useFakeTimers();
    const h = dotHarness();
    const fallback = vi.fn(async () => undefined);
    h.set({ setFireActive: fallback });
    await h.actions.switchPositioningLightOn();
    h.after((line) => {
      if (line === 'M5') h.set({ controllerSessionEpoch: h.get().controllerSessionEpoch + 1 });
    });
    h.fail('M5');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fallback).not.toHaveBeenCalled();
    const sent = h.writes.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.writes).toHaveLength(sent);
  });
  it('refuses the infrared module, whose beam would show nothing', async () => {
    const h = dotHarness();
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        device: { ...project.device, laserSubProfile: FALCON_A1_PRO_INFRARED_2W_MODULE },
      },
    });
    await expect(h.actions.switchPositioningLightOn()).rejects.toThrow('beam is invisible');
    expect(h.writes).toEqual([]);
    expect(h.get().fireActive).toBe(false);
  });

  it('refuses the dot on another machine profile without sending anything', async () => {
    const h = dotHarness();
    const project = useStore.getState().project;
    const { controllerCommandSet: _falcon, ...device } = project.device;
    useStore.setState({ project: { ...project, device } });
    await expect(h.actions.switchPositioningLightOn()).rejects.toThrow(
      'needs the Creality Falcon A1 Pro machine profile',
    );
    expect(h.writes).toEqual([]);
  });

  it('LASER OFF (Fire off) also records the dot off', async () => {
    const h = dotHarness();
    await h.actions.switchPositioningLightOn();
    const written: string[] = [];
    const { setFireActive } = fireActions(
      h.set,
      h.get,
      async (line) => {
        written.push(line);
      },
      async () => undefined,
    );
    await setFireActive(false);
    expect(written).toEqual(['M5\n']);
    expect(h.get()).toMatchObject({ positioningLightEnabled: false, fireActive: false });
  });
});
