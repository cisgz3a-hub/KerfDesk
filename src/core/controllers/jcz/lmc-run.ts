// LMC command sequences (ADR-704), in MeerK40t's order (balormk/controller.py
// at d511944e). Connect runs init_laser (L853-935) with MeerK40t's default
// parameters (device.py L768-950). A program runs as program_mode or
// light_mode opens it (L486-561), each list waiting for the board's Ready bit,
// then followed by Set End Of List 0, with Execute List after the third list
// or after the last (L567-587, L464-473). It ends as rapid_mode ends it:
// master oscillator closed, program port bit off (L474-477). Abort is
// MeerK40t's abort (L821-839): Stop Execute, close the oscillator, Reset List,
// one empty list, port off. Pause is Stop List and Resume is Restart List
// (L841-851). Simulator-tested only; not qualified on hardware.

import type { LmcCorrectionTable } from './lmc-cor-file';
import type { LmcLink } from './lmc-link';
import {
  LMC_ENABLE_LASER,
  LMC_ENABLE_Z,
  LMC_EXECUTE_LIST,
  LMC_FIBER_SET_MO,
  LMC_GET_SERIAL_NO,
  LMC_GET_VERSION,
  LMC_PORT_PROGRAM_BIT,
  LMC_RESET,
  LMC_RESET_LIST,
  LMC_RESTART_LIST,
  LMC_SET_CONTROL_MODE,
  LMC_SET_DELAY_MODE,
  LMC_SET_END_OF_LIST,
  LMC_SET_FIRST_PULSE_KILLER,
  LMC_SET_FLY_RES,
  LMC_SET_FPK_PARAM_2,
  LMC_SET_LASER_MODE,
  LMC_SET_PWM_HALF_PERIOD,
  LMC_SET_PWM_PULSE_WIDTH,
  LMC_SET_STANDBY,
  LMC_SET_TIMING,
  LMC_STOP_EXECUTE,
  LMC_STOP_LIST,
  LMC_WRITE_ANALOG_PORT_1,
  LMC_WRITE_COR_LINE,
  LMC_WRITE_COR_TABLE,
  LMC_WRITE_PORT,
} from './lmc-opcodes';
import { emptyLmcList, type LmcParams } from './lmc-packets';

type Step = readonly [number, ...LmcParams];

// MeerK40t's init_laser after the correction table, with its defaults:
// control mode 0, laser mode 1, delay mode 1, timing 1, standby 2000/20,
// first pulse killer 200, PWM half period 125 and pulse width 125, MO closed,
// FPK parameters 0xFFB/1/409 with the fourth repeating the third as MeerK40t
// sends it (L869), fly resolution 0/99/1000/25, Z on, analog port 1 at 0x7FF.
const INIT_AFTER_CORRECTION: ReadonlyArray<Step> = [
  [LMC_ENABLE_LASER],
  [LMC_SET_CONTROL_MODE, 0],
  [LMC_SET_LASER_MODE, 1],
  [LMC_SET_DELAY_MODE, 1],
  [LMC_SET_TIMING, 1],
  [LMC_SET_STANDBY, 2000, 20],
  [LMC_SET_FIRST_PULSE_KILLER, 200],
  [LMC_SET_PWM_HALF_PERIOD, 125],
  [LMC_SET_PWM_PULSE_WIDTH, 125],
  [LMC_FIBER_SET_MO, 0],
  [LMC_SET_FPK_PARAM_2, 0xffb, 1, 409, 409],
  [LMC_SET_FLY_RES, 0, 99, 1000, 25],
  [LMC_ENABLE_Z],
  [LMC_WRITE_ANALOG_PORT_1, 0x7ff],
  [LMC_ENABLE_Z],
];

export type LmcInitResult =
  | { readonly ok: true; readonly serial: string; readonly version: string }
  | { readonly ok: false; readonly reason: string };

export async function initializeLmcBoard(
  link: LmcLink,
  correction: LmcCorrectionTable | null,
): Promise<LmcInitResult> {
  const serial = await link.command(LMC_GET_SERIAL_NO);
  const version = await link.command(LMC_GET_VERSION);
  if (serial === null || version === null) return failed(link, 'read its serial number');
  if ((await link.command(LMC_RESET)) === null) return failed(link, 'reset');
  if (!(await writeCorrection(link, correction))) return failed(link, 'take the lens correction');
  for (const [opcode, ...params] of INIT_AFTER_CORRECTION) {
    if ((await link.command(opcode, ...params)) === null) return failed(link, 'take its settings');
  }
  return { ok: true, serial: hexWords(serial), version: hexWords(version) };
}

async function writeCorrection(link: LmcLink, table: LmcCorrectionTable | null): Promise<boolean> {
  if (table === null) return (await link.command(LMC_WRITE_COR_TABLE, 0)) !== null;
  if ((await link.command(LMC_WRITE_COR_TABLE, 1)) === null) return false;
  for (let index = 0; index < table.length; index += 1) {
    const [dx, dy] = table[index] ?? [0, 0];
    if (!(await link.commandWithoutReply(LMC_WRITE_COR_LINE, dx, dy, index === 0 ? 0 : 1)))
      return false;
  }
  return true;
}

function failed(link: LmcLink, what: string): LmcInitResult {
  return { ok: false, reason: `The board did not ${what}. ${link.lastFailure ?? ''}`.trim() };
}

function hexWords(words: ReadonlyArray<number>): string {
  return words.map((word) => word.toString(16).padStart(4, '0')).join('');
}

export type LmcProgramKind = 'job' | 'frame';

export type LmcRunHooks = {
  /** Stop sending further lists (Abort). */
  readonly cancelled: () => boolean;
  /** Hold further lists while the operator has paused (controller.py L576-577). */
  readonly paused: () => boolean;
  readonly onProgress: (sent: number, total: number) => void;
  readonly sleep: (ms: number) => Promise<void>;
};

export type LmcRunResult =
  | { readonly ok: true; readonly executing: true }
  | {
      readonly ok: false;
      readonly failure: 'cancelled' | 'not-ready' | 'link';
      readonly sent: number;
      readonly executing: boolean;
    };

/** How long a list may wait for the board's Ready bit. */
export const LMC_READY_POLLS = 3000;
const READY_POLL_MS = 10;

export async function runLmcProgram(
  link: LmcLink,
  lists: ReadonlyArray<Uint8Array>,
  kind: LmcProgramKind,
  fiber: boolean,
  hooks: LmcRunHooks,
): Promise<LmcRunResult> {
  if (!(await openProgram(link, kind, fiber))) return linkFailure(0, false);
  let executing = false;
  for (let index = 0; index < lists.length; index += 1) {
    const list = lists[index];
    if (list === undefined) continue;
    const failure = await sendOneList(link, list, index, executing, hooks);
    if (failure !== null) return failure;
    hooks.onProgress(index + 1, lists.length);
    if (index + 1 > 2 && !executing) {
      if ((await link.command(LMC_EXECUTE_LIST)) === null) return linkFailure(index + 1, false);
      executing = true;
    }
  }
  if (!executing && (await link.command(LMC_EXECUTE_LIST)) === null)
    return linkFailure(lists.length, false);
  return { ok: true, executing: true };
}

// program_mode raises port bit 0 and opens a fiber's MO; light_mode does
// neither, so a Frame never readies the source (controller.py L486-561).
async function openProgram(link: LmcLink, kind: LmcProgramKind, fiber: boolean): Promise<boolean> {
  if ((await link.command(LMC_RESET_LIST)) === null) return false;
  if (kind !== 'job') return true;
  if ((await link.command(LMC_WRITE_PORT, 1 << LMC_PORT_PROGRAM_BIT)) === null) return false;
  return !fiber || (await link.command(LMC_FIBER_SET_MO, 1)) !== null;
}

/** One list after the board is Ready, then Set End Of List 0; null when sent. */
async function sendOneList(
  link: LmcLink,
  list: Uint8Array,
  index: number,
  executing: boolean,
  hooks: LmcRunHooks,
): Promise<LmcRunResult | null> {
  const ready = await waitForList(link, hooks);
  if (ready !== 'ready') return { ok: false, failure: ready, sent: index, executing };
  if (!(await link.sendList(list))) return linkFailure(index, executing);
  if ((await link.command(LMC_SET_END_OF_LIST, 0)) === null)
    return linkFailure(index + 1, executing);
  return null;
}

async function waitForList(
  link: LmcLink,
  hooks: LmcRunHooks,
): Promise<'ready' | 'cancelled' | 'not-ready' | 'link'> {
  // Only reads of the board count towards the limit: a pause holds the next
  // list for as long as the operator wants (audit of the last 200 PRs, #1725).
  let polls = 0;
  while (polls < LMC_READY_POLLS) {
    if (hooks.cancelled()) return 'cancelled';
    if (!hooks.paused()) {
      const status = await link.boardStatus();
      if (status === null) return 'link';
      if (status.ready) return 'ready';
      polls += 1;
    }
    await hooks.sleep(READY_POLL_MS);
  }
  return 'not-ready';
}

function linkFailure(sent: number, executing: boolean): LmcRunResult {
  return { ok: false, failure: 'link', sent, executing };
}

/** After the board went idle: close the oscillator, lower the port bits. */
export async function finishLmcProgram(link: LmcLink, fiber: boolean): Promise<boolean> {
  const closed = !fiber || (await link.command(LMC_FIBER_SET_MO, 0)) !== null;
  const portOff = (await link.command(LMC_WRITE_PORT, 0)) !== null;
  return closed && portOff;
}

/** MeerK40t's abort; true when the board acknowledged Stop Execute. */
export async function abortLmcProgram(link: LmcLink, executing: boolean): Promise<boolean> {
  const stopped = (await link.command(LMC_STOP_EXECUTE)) !== null;
  await link.command(LMC_FIBER_SET_MO, 0);
  await link.command(LMC_RESET_LIST);
  // One empty list closes the reset list (controller.py L828-833).
  if (await link.sendList(emptyLmcList())) {
    await link.command(LMC_SET_END_OF_LIST, 0);
    if (!executing) await link.command(LMC_EXECUTE_LIST);
  }
  await link.command(LMC_FIBER_SET_MO, 0);
  await link.command(LMC_WRITE_PORT, 0);
  return stopped;
}

export async function pauseLmcProgram(link: LmcLink): Promise<boolean> {
  return (await link.command(LMC_STOP_LIST)) !== null;
}

export async function resumeLmcProgram(link: LmcLink): Promise<boolean> {
  return (await link.command(LMC_RESTART_LIST)) !== null;
}
