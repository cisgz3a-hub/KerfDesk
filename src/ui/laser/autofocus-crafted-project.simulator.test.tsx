// Audit 13-P1-1 (regression). A shared `.lf2` carried `device.autofocusCommand`
// with only a string check, and one Auto-focus press sent it verbatim: a burn
// (`G1 X300 Y10 F100 S1000 M3`), a head move or a `$32=0` settings write. The
// path here is the real one: File > Open, the Auto-focus button and the GRBL
// simulator (ADR-400 Amendment 1).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
// Deep import: the devices barrel is at its public-export ratchet.
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { createProject } from '../../core/scene';
import { serializeProject } from '../../io/project';
import type { PlatformAdapter } from '../../platform/types';
import { openProjectCommand } from '../commands/open-project-command';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { JobSetupControls } from './JobSetupControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const original = useLaserStore.getState();

const PAYLOADS = ['G1 X300 Y10 F100 S1000 M3', 'G0 X400 Y400', '$32=0', 'M3 S1000', 'M17'] as const;

async function pump(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** A file for the operator's own machine (same profile id, name and bed, so no
 *  machine notice shows), or for another machine when `deviceName` is given. */
function craftedFile(payload: string, deviceName?: string): string {
  const json = JSON.parse(serializeProject(createProject(useStore.getState().project.device))) as {
    device: Record<string, unknown>;
  };
  json.device['autofocusCommand'] = payload;
  if (deviceName !== undefined) json.device['name'] = deviceName;
  return JSON.stringify(json);
}

async function openText(text: string): Promise<string[]> {
  const toasts: string[] = [];
  const platform: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
  await openProjectCommand(platform, (message) => toasts.push(message), {
    file: { name: 'sign.lf2', text: async () => text },
  });
  return toasts;
}

async function pressAutofocus(): Promise<string | null> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <JobSetupControls
        disabled={false}
        streaming={false}
        onConfigureAutofocus={() => undefined}
        onConfigureHoming={() => undefined}
      />,
    );
  });
  try {
    const button = [...host.querySelectorAll('button')].find((candidate) =>
      /auto-focus/i.test(candidate.textContent ?? ''),
    );
    await act(async () => button?.click());
    for (let tick = 0; tick < 40; tick += 1) await pump(250);
    return button?.textContent ?? null;
  } finally {
    await act(async () => root?.unmount());
    host.remove();
  }
}

function setOwnAutofocus(command: string): void {
  const project = createProject();
  useStore.setState({
    project: { ...project, device: { ...project.device, autofocusCommand: command } },
  });
}

/** The operator's own Falcon A1 Pro, whose `$HZ1` is its documented autofocus. */
async function connectOwnFalcon(): Promise<GrblSimulator> {
  useStore.setState({ project: createProject(FALCON_A1_PRO_GRBLHAL_PROFILE) });
  const sim = createGrblSimulator({ firmwareBanner: 'GrblHAL 1.1f' });
  await useLaserStore.getState().connect(sim.adapter, {
    controllerKind: 'grblhal',
    controllerCommandSet: 'creality-falcon-a1-pro',
  });
  await pump(2_000);
  return sim;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(original, true);
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('a crafted project Auto-focus command never reaches the controller', () => {
  it.each(PAYLOADS)('a file for this machine keeps the operator command: %s', async (payload) => {
    const sim = await connectOwnFalcon();

    const toasts = await openText(craftedFile(payload));
    expect(useStore.getState().project.device.autofocusCommand).toBe('$HZ1');
    expect(useStore.getState().projectBedReconciliation).toBeNull();
    expect(toasts.join(' ')).toMatch(/Opened sign\.lf2/);

    const sentFrom = sim.outbound().length;
    await pressAutofocus();
    const sent = sim.outbound().slice(sentFrom);
    expect(sent).not.toContain(`${payload}\n`);
    // Status polls and the blank lines the Falcon link writes are not commands.
    expect(sent.filter((line) => line !== '?' && line.trim() !== '')).toEqual(['$HZ1\n']);
    expect(sim.state().settings.get(32)).not.toBe(0);
  });

  it.each(PAYLOADS)('a file for another machine loses the command on load: %s', async (payload) => {
    setOwnAutofocus('');
    const sim = createGrblSimulator();
    await useLaserStore.getState().connect(sim.adapter);
    await pump(2_000);

    await openText(craftedFile(payload, 'Shared sign machine'));
    expect(useStore.getState().projectBedReconciliation?.machineChanged).toBe(true);
    expect(useStore.getState().project.device.autofocusCommand).toBe('');

    const sentFrom = sim.outbound().length;
    expect(await pressAutofocus()).toBe('Set up auto-focus');
    expect(
      sim
        .outbound()
        .slice(sentFrom)
        .filter((line) => line !== '?'),
    ).toEqual([]);
  });

  it.each(PAYLOADS)('the button refuses %s whatever its source', async (payload) => {
    const sim = createGrblSimulator();
    await useLaserStore.getState().connect(sim.adapter);
    await pump(2_000);
    const sentFrom = sim.outbound().length;

    const result = await useLaserStore.getState().autofocus(payload);

    expect(result.kind).toBe('preflight-failed');
    expect(
      sim
        .outbound()
        .slice(sentFrom)
        .filter((line) => line !== '?'),
    ).toEqual([]);
    expect(useLaserStore.getState().autofocusBusy).toBe(false);
  });

  // Codex review on #1352: stock GRBL starts homing on `$H`, then refuses the
  // suffix with error:3 and stays stuck until a reset (grbl-sim-lines.ts).
  it('refuses the Falcon $HZ1 on stock GRBL, which it would leave stuck homing', async () => {
    setOwnAutofocus('$HZ1');
    const sim = createGrblSimulator();
    await useLaserStore.getState().connect(sim.adapter);
    await pump(2_000);
    const sentFrom = sim.outbound().length;

    const result = await useLaserStore.getState().autofocus('$HZ1');

    expect(result).toEqual({
      kind: 'preflight-failed',
      reason: expect.stringMatching(/stuck until a reset/),
    });
    expect(
      sim
        .outbound()
        .slice(sentFrom)
        .filter((line) => line !== '?'),
    ).toEqual([]);
    expect(sim.state().machine).toBe('Idle');
  });
});
