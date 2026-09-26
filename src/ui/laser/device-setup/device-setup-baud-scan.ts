// "Try other speeds" in Find my machine (ADR-420). When the controller heard
// nothing at the selected baud, reconnect to the same remembered port at each
// common speed until one answers. Reads only: every attempt is the ordinary
// connection handshake, which sends status, settings and identity queries.

import type { ConnectionState } from '../../state/laser-store';

// Common GRBL-family, Marlin and vendor speeds, most likely first.
export const COMMON_BAUD_RATES: ReadonlyArray<number> = [
  115200, 230400, 250000, 921600, 57600, 38400, 19200, 9600,
];

/** What the scan needs from the live store; injected so the scan is testable. */
export type BaudScanLink = {
  readonly connectAt: (baudRate: number) => Promise<void>;
  readonly disconnect: () => Promise<void>;
  /** Resolves once the connection answered, stayed silent, or failed. */
  readonly awaitAnswer: () => Promise<BaudScanAnswer>;
  readonly cancelled: () => boolean;
};

export type BaudScanAnswer = 'answered' | 'silent' | 'failed';

export type BaudScanResult =
  | { readonly kind: 'found'; readonly baudRate: number }
  | { readonly kind: 'none'; readonly tried: ReadonlyArray<number> }
  | { readonly kind: 'cancelled' };

export function baudScanCandidates(skip: ReadonlyArray<number>): ReadonlyArray<number> {
  return COMMON_BAUD_RATES.filter((baud) => !skip.includes(baud));
}

// A cancelled scan returns before its next step and never cleans up: once the
// operator pressed Stop or connected another way, the open connection is not
// the scan's to close. So cancellation is checked after every await.
export async function scanBaudRates(
  link: BaudScanLink,
  candidates: ReadonlyArray<number>,
  onTry: (baudRate: number, index: number) => void,
): Promise<BaudScanResult> {
  const tried: number[] = [];
  for (const [index, baudRate] of candidates.entries()) {
    if (link.cancelled()) return CANCELLED;
    onTry(baudRate, index);
    await link.disconnect();
    if (link.cancelled()) return CANCELLED;
    await link.connectAt(baudRate);
    if (link.cancelled()) return CANCELLED;
    const answer = await link.awaitAnswer();
    if (link.cancelled()) return CANCELLED;
    tried.push(baudRate);
    if (answer === 'answered') return { kind: 'found', baudRate };
    // A port that will not open at all will not open at another speed either.
    if (answer === 'failed') return { kind: 'none', tried };
  }
  await link.disconnect();
  return { kind: 'none', tried };
}

const CANCELLED: BaudScanResult = { kind: 'cancelled' };

/** One owner per scan: `claim` starts a scan and returns its "retired" check,
 *  which turns true once `retire` runs or a later scan claims. */
export function createBaudScanOwnership(): {
  readonly claim: () => () => boolean;
  readonly retire: () => void;
} {
  let current = 0;
  return {
    claim: () => {
      current += 1;
      const mine = current;
      return () => current !== mine;
    },
    retire: () => {
      current += 1;
    },
  };
}

/** How the live connection stands for a scan attempt. */
export function baudScanAnswer(state: {
  readonly connection: ConnectionState;
  readonly statusReport: unknown;
  readonly detectedControllerKind: unknown;
  readonly controllerQualification: { readonly kind: string };
}): BaudScanAnswer | null {
  if (state.connection.kind === 'failed' || state.connection.kind === 'disconnected') {
    return 'failed';
  }
  if (state.connection.kind !== 'connected') return null;
  if (state.statusReport !== null || state.detectedControllerKind !== null) return 'answered';
  return state.controllerQualification.kind === 'failed' ? 'silent' : null;
}
