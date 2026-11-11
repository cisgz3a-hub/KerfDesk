// Rolling audit v11 W2-P2-1 (ADR-585 Amendment 2): a paused CNC job's Resume
// advisory, which the PC shows in the paused job panel and on the Resume
// button, reaches phones and MCP clients, and a remote Resume where the PC
// prefers ABORT JOB needs that warning confirmed. Real remote adapter, real
// store, scripted GRBL simulator (with a FluidNC banner for the P1 branch).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGrblSimulator,
  type CreateGrblSimulatorOptions,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene/machine';
import {
  mcpMachineInputSchemas,
  mcpMachineOutputSchemas,
} from '../../../electron/mcp/machine-schemas';
import {
  cncJobLaserModeEnabled,
  cncPauseControllerKind,
  cncPauseLiftPhase,
  cncPauseLiftSkipReason,
} from '../state/cnc-pause-lift-state';
import {
  CNC_RESUME_FLUIDNC_ADVISORY_MESSAGE,
  CNC_RESUME_LASER_MODE_ADVISORY_MESSAGE,
  cncResumeAdvisoryNotice,
} from '../state/cnc-pause-resume-policy';
import { cncControllerEpochOf, createCncSetupAttestation } from '../state/cnc-setup-attestation';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { testAdapter } from './authoring-test-support';
import type { RemoteControlAdapter } from './types';

const PROGRAM = [
  'G21',
  'G90',
  'G0 Z5',
  'M3 S12000',
  'G4 P1',
  'G0 X0 Y0',
  'G1 Z-1 F150',
  ...Array.from({ length: 20 }, (_, index) => `G1 X${index + 1} F600`),
  'G0 Z5',
  'M5',
].join('\n');
const FLUIDNC_BANNER = "Grbl 3.7 [FluidNC v4.0.3 (wifi) '$' for help]";
type Receipt = { state: string; message?: string };
type Advisory = { message: string; confirmation?: string };

let adapter: RemoteControlAdapter | undefined;
let authority: AbortController;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  authority = new AbortController();
});
afterEach(async () => {
  adapter?.dispose();
  adapter = undefined;
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    streamer: null,
    cncPauseLift: null,
    cncPauseLiftJob: null,
    controllerSettings: null,
  });
  resetStore();
  vi.restoreAllMocks();
});

const pump = (ms = 10) => vi.advanceTimersByTimeAsync(ms);
async function settle<T>(promise: Promise<T>, limit = 30_000): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  tracked.catch(() => undefined);
  for (let elapsed = 0; elapsed < limit && !done; elapsed += 20) await pump(20);
  return tracked;
}

async function startPausedCncJob(options: CreateGrblSimulatorOptions, fluidnc: boolean) {
  useStore.setState((state) => ({
    project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
  }));
  const sim = createGrblSimulator({ motionMs: 100, plannerBlocks: 4, ...options });
  await useLaserStore
    .getState()
    .connect(sim.adapter, fluidnc ? { controllerKind: 'fluidnc' } : undefined);
  await pump(20);
  await pump(1100);
  const caller = { clientId: 'phone', sessionId: 'session' };
  adapter = testAdapter({
    canWrite: () => false,
    getRemoteCaller: () => caller,
    captureMachineAuthority: () => ({
      ...caller,
      signal: authority.signal,
      assertCurrent: () => authority.signal.throwIfAborted(),
    }),
  });
  const state = useLaserStore.getState();
  await settle(
    state.startJob(PROGRAM, {
      machineKind: 'cnc',
      cncSetupAttestation: createCncSetupAttestation(PROGRAM, cncControllerEpochOf(state)),
    }),
    5_000,
  );
  await pump(1500);
  const paused = await remote('pause_job');
  return { sim, paused };
}

async function receipt(operationId: string): Promise<Receipt> {
  const result = await adapter!.execute('get_control_operation', { operationId });
  if (!result.ok) throw new Error(result.error.code);
  return result.data['operation'] as Receipt;
}
async function remote(command: 'pause_job' | 'resume_job', args: Record<string, unknown> = {}) {
  const requestId = crypto.randomUUID();
  const result = await adapter!.execute(command, { requestId, ...args });
  if (!result.ok) throw new Error(`${command}: ${result.error.code}`);
  for (let attempt = 0; attempt < 1500; attempt += 1) {
    const operation = await receipt(requestId);
    if (['completed', 'failed', 'unknown', 'cancelled'].includes(operation.state)) return operation;
    await pump(20);
  }
  throw new Error(`${command} never settled`);
}
async function status(): Promise<Record<string, unknown>> {
  const result = await adapter!.execute('get_machine_status', {});
  if (!result.ok) throw new Error(result.error.code);
  return result.data;
}
function pcAdvisory(): string | null {
  const state = useLaserStore.getState();
  return cncResumeAdvisoryNotice(
    state.activeJobMachineKind,
    cncJobLaserModeEnabled(state),
    cncPauseLiftPhase(state),
    cncPauseLiftSkipReason(state),
    cncPauseControllerKind(state),
  );
}
function resumeAdvisory(data: Record<string, unknown>): Advisory | undefined {
  return (data['job'] as { resumeAdvisory?: Advisory }).resumeAdvisory;
}

describe('remote Resume of a paused CNC job (W2-P2-1)', () => {
  it('FluidNC at $32=0: the status and Pause receipt carry the PC advisory; Resume needs it confirmed', async () => {
    const { sim, paused } = await startPausedCncJob(
      { settings: [[32, '0']], firmwareBanner: FLUIDNC_BANNER },
      true,
    );
    expect(pcAdvisory()).toBe(CNC_RESUME_FLUIDNC_ADVISORY_MESSAGE);
    expect(paused).toMatchObject({
      state: 'completed',
      message: `Paused. ${CNC_RESUME_FLUIDNC_ADVISORY_MESSAGE}`,
    });

    const data = await status();
    const advisory = resumeAdvisory(data);
    expect(advisory?.message).toBe(CNC_RESUME_FLUIDNC_ADVISORY_MESSAGE);
    expect(advisory?.confirmation).toMatch(/^[0-9a-f]{8}$/);
    // The desktop MCP server and the relay Worker re-parse with this schema; the field survives.
    const parsed = mcpMachineOutputSchemas.get_machine_status.parse({ revision: 'r1', ...data });
    expect(parsed.job.resumeAdvisory).toEqual(advisory);

    const before = sim.outbound().length;
    const unconfirmed = await remote('resume_job');
    expect(unconfirmed.state).toBe('failed');
    expect(unconfirmed.message).toContain('Not resumed: this paused CNC job has a Resume warning');
    expect(unconfirmed.message).toContain(CNC_RESUME_FLUIDNC_ADVISORY_MESSAGE);
    expect(unconfirmed.message).toContain('abort the job');
    const wrong = await remote('resume_job', { confirmAdvisory: '00000000' });
    expect(wrong.state).toBe('failed');
    expect(wrong.message).toContain('the Resume warning changed since it was confirmed');
    await pump(500);
    expect(sim.outbound().slice(before)).not.toContain('~');
    expect(useLaserStore.getState().streamer?.status).toBe('paused');

    const confirmed = await remote('resume_job', { confirmAdvisory: advisory?.confirmation });
    expect(confirmed).toMatchObject({ state: 'completed', message: 'Resumed.' });
    expect(sim.outbound().slice(before)).toContain('~');
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    expect(resumeAdvisory(await status())).toBeUndefined();
  }, 60_000);

  it('GRBL with laser mode on: the same confirmation, with the $32 advisory', async () => {
    const { sim } = await startPausedCncJob({ settings: [[32, '1']] }, false);
    const advisory = resumeAdvisory(await status());

    expect(pcAdvisory()).toContain(CNC_RESUME_LASER_MODE_ADVISORY_MESSAGE);
    expect(advisory?.message).toBe(pcAdvisory());
    expect(advisory?.confirmation).toMatch(/^[0-9a-f]{8}$/);
    const before = sim.outbound().length;
    expect((await remote('resume_job')).state).toBe('failed');
    expect(sim.outbound().slice(before)).not.toContain('~');
    const confirmed = await remote('resume_job', { confirmAdvisory: advisory?.confirmation });
    expect(confirmed.state).toBe('completed');
    expect(sim.outbound().slice(before)).toContain('~');
  }, 60_000);

  it('stock GRBL at $32=0: the advisory is shown but the PC only informs, so no confirmation', async () => {
    await startPausedCncJob({ settings: [[32, '0']] }, false);
    for (
      let wait = 0;
      wait < 400 && cncPauseLiftPhase(useLaserStore.getState()) === 'lifting';
      wait++
    )
      await pump(50);
    const advisory = resumeAdvisory(await status());

    expect(advisory).toEqual({ message: pcAdvisory() });
    expect(advisory?.message).not.toContain('Prefer ABORT JOB');
    const resumed = await remote('resume_job');
    expect(resumed.message ?? '').not.toContain('Not resumed');
  }, 60_000);

  it('validates confirmAdvisory as an 8-digit code on the desktop and in the MCP schema', async () => {
    adapter = testAdapter({ canWrite: () => false });
    const requestId = crypto.randomUUID();
    for (const confirmAdvisory of ['ABCDEF12', 'abc', 7, '']) {
      const result = await adapter.execute('resume_job', { requestId, confirmAdvisory });
      expect(result.ok ? 'ok' : result.error.code).toBe('invalid_arguments');
      expect(
        mcpMachineInputSchemas.resume_job.safeParse({ requestId, confirmAdvisory }).success,
      ).toBe(false);
    }
    expect(
      mcpMachineInputSchemas.resume_job.safeParse({ requestId, confirmAdvisory: '0a1b2c3d' })
        .success,
    ).toBe(true);
    const extra = await adapter.execute('pause_job', { requestId, confirmAdvisory: '0a1b2c3d' });
    expect(extra.ok ? 'ok' : extra.error.code).toBe('invalid_arguments');
  });
});
