// Real emitter, store and controller simulation; no hardware is operated.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import { createLayer, createProject } from '../../core/scene';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { JogPadAirAssist } from '../../ui/laser/JogPadAirAssist';
import { initialLaserState } from '../../ui/state/laser-store-helpers';
import { useLaserStore } from '../../ui/state/laser-store';
import { startTestLaserJob } from '../../ui/state/laser-test-start-helpers';
import { useStore } from '../../ui/state/store';
import { resetStore, svgObj } from '../../ui/state/test-helpers';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useLaserStore.setState(initialLaserState());
  localStorage.clear();
});

afterEach(async () => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  resetStore();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function onClock<T>(pending: Promise<T>): Promise<T> {
  let settled = false;
  const outcome = pending
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    .finally(() => {
      settled = true;
    });
  for (let tick = 0; tick < 2000 && !settled; tick += 1) await vi.advanceTimersByTimeAsync(1);
  expect(settled, 'The owned simulator action did not settle.').toBe(true);
  const result = await outcome;
  if (!result.ok) throw result.error;
  return result.value;
}

describe('automatic job Air completion', () => {
  it('shows OFF after automatic M9 settles and the next manual click enables the configured output', async () => {
    const base = createProject();
    const project = {
      ...base,
      device: { ...base.device, airAssistCommand: 'M8' as const },
      scene: {
        ...base.scene,
        objects: [svgObj('audit-air-line', ['#ff0000'])],
        layers: [{ ...createLayer({ id: 'audit-air', color: '#ff0000' }), airAssist: true }],
      },
    };
    useStore.setState({ project });
    const sim = createGrblSimulator();
    await useLaserStore.getState().connect(sim.adapter);
    await vi.advanceTimersByTimeAsync(1120);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');

    await onClock(useLaserStore.getState().setAirAssistEnabled(true));
    await vi.advanceTimersByTimeAsync(10);
    expect(useLaserStore.getState().airAssistOn).toBe(true);
    expect(sim.outbound()).toContain('M8\n');

    const prepared = prepareOutput(project);
    if (!prepared.ok) throw new Error('Audit job did not compile.');
    const { gcode } = emitPreparedGcode(prepared);
    expect(gcode).toContain('\nM8\n');
    expect(gcode).toContain('\nM9\n');
    const beforeStart = sim.outbound().length;
    await onClock(startTestLaserJob(gcode));
    await vi.advanceTimersByTimeAsync(3000);
    const state = useLaserStore.getState();
    expect(state.streamer).toBeNull();
    expect(state.controllerOperation).toBeNull();
    expect(state.statusReport?.state).toBe('Idle');
    expect(state.safetyNotice).toBeNull();
    expect(state.airAssistOn).toBe(false);
    const jobWrites = sim.outbound().slice(beforeStart).join('');
    expect(jobWrites).toContain('M9\n');
    expect(jobWrites).toContain('G4 P0.01\n');

    // Inject a firmware-reported all-off accessory observation. This is only
    // controller/model evidence, not physical pump/relay feedback.
    sim.port.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
    expect(useLaserStore.getState().accessoryCache).toMatchObject({ flood: false, mist: false });
    expect(useLaserStore.getState().airAssistOn).toBe(false);

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(createElement(JogPadAirAssist)));
    const button = host.querySelector('button');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(button?.textContent).toContain('OFF');
    const beforeClick = sim.outbound().length;
    await act(async () => {
      button?.click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(sim.outbound().slice(beforeClick)).toContain('M8\n');
    expect(sim.outbound().slice(beforeClick)).not.toContain('M9\n');
    expect(useLaserStore.getState().airAssistOn).toBe(true);
  });

  it.each(['M7', 'none'] as const)(
    'keeps the active M8 output truthful after Open selects %s and reconciles M9 without accessory reports',
    async (nextCommand) => {
      const project = createProject();
      useStore.getState().setProject({
        ...project,
        device: { ...project.device, airAssistCommand: 'M8' },
      });
      const sim = createGrblSimulator();
      await useLaserStore.getState().connect(sim.adapter);
      await vi.advanceTimersByTimeAsync(1120);
      await onClock(useLaserStore.getState().setAirAssistEnabled(true));
      expect(useLaserStore.getState().airAssistOn).toBe(true);

      // The in-program dwell keeps the old run active across document replacement.
      // The simulator models its serial/ACK ordering; accessory observations are
      // explicit controller report inputs, never measured airflow.
      const gcode = 'G21\nG90\nM8\nG1 X10 F600 S100\nG4 P1\nM9\nM5\n';
      const beforeStart = sim.outbound().length;
      await onClock(startTestLaserJob(gcode));
      await vi.advanceTimersByTimeAsync(10);
      expect(useLaserStore.getState().streamer?.status).toBe('streaming');
      const activeStream = useLaserStore.getState().streamer;
      useStore.getState().setProject({
        ...createProject(),
        device: { ...project.device, airAssistCommand: nextCommand },
      });
      expect(useLaserStore.getState().streamer).toBe(activeStream);
      sim.port.emitLine('<Run|MPos:10.000,0.000,0.000|FS:600,100|A:F|Ov:100,100,100>');
      expect(useLaserStore.getState().airAssistOn).toBe(true);
      expect(useLaserStore.getState().accessoryCache).toMatchObject({ flood: true, mist: false });

      // Now model firmware without fresh accessory evidence. The final settled
      // M9 must still clear both outputs even when the opened device uses none.
      const deliverLine = sim.port.emitLine;
      vi.spyOn(sim.port, 'emitLine').mockImplementation((line) =>
        deliverLine(line.startsWith('<') ? line.replace(/\|(?:Ov|A):[^|>]*/g, '') : line),
      );
      await vi.advanceTimersByTimeAsync(3000);
      const state = useLaserStore.getState();
      expect(state.streamer).toBeNull();
      expect(state.controllerOperation).toBeNull();
      expect(state.safetyNotice).toBeNull();
      expect(state.statusReport?.accessories).toBeNull();
      expect(state.airAssistOn).toBe(false);
      expect(sim.outbound().slice(beforeStart).join('')).toContain('M9\n');
    },
  );
});
