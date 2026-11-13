// Which connection's first answer settles which saved lost-link run
// (ADR-398 Amendment 3), and which answers prove a restart on which link
// (Amendment 4). The laser store is driven directly; the repository is a
// stand-in that records the settlements asked of it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrblState, StatusReport } from '../../core/controllers/grbl';
import type { LinkLossRestartSign } from '../../core/recovery/link-loss-restart';
import type { SerialPortIdentity } from '../../platform/types';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import type {
  RecoveryCapsule,
  RecoveryRepository,
  RecoveryRepositorySnapshot,
} from '../state/recovery';
import {
  installLinkLossRestartTracking,
  linkLossRestartEvidence,
} from './link-loss-restart-tracking';

const BACKLOG = { ackedAtStatus: 40, queuedBlocks: 15, bound: 'planner-size' } as const;
const TCP: SerialPortIdentity = { transport: 'tcp' };
// A grblHAL native-USB board (STMicroelectronics virtual COM port).
const NATIVE_USB: SerialPortIdentity = { usbVendorId: 0x0483, usbProductId: 0x5740 };

function lostLinkCapsule(runId: string, machineKind: 'laser' | 'cnc' = 'laser'): RecoveryCapsule {
  // Only the identity, the machine kind and the interruption are read here.
  return {
    runId,
    revision: 4,
    artifact: { machineKind },
    interruption: { kind: 'disconnect', message: 'Lost.', plannerBacklogIfRestarted: BACKLOG },
  } as unknown as RecoveryCapsule;
}

function fakeRepository(initial: RecoveryCapsule | null) {
  let snapshot = { loaded: true, recoveryCapsule: initial } as RecoveryRepositorySnapshot;
  const listeners = new Set<() => void>();
  const settle = vi.fn(() => Promise.resolve({ ok: true as const, value: true }));
  const repository = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    settleLinkLossRestart: settle,
  } as unknown as RecoveryRepository;
  const save = (capsule: RecoveryCapsule | null): void => {
    snapshot = { ...snapshot, recoveryCapsule: capsule };
    for (const listener of listeners) listener();
  };
  return { repository, settle, save };
}

const status = (state: GrblState): StatusReport => ({ state }) as StatusReport;
const usb = (sign: LinkLossRestartSign) => ({ sign, link: 'usb' }) as const;
const network = (sign: LinkLossRestartSign) => ({ sign, link: 'network' }) as const;

/** The connected state arrives with its port info, as the store sets it. */
function connect(serialPortInfo: SerialPortIdentity | null = null): void {
  useLaserStore.setState({
    connection: { kind: 'connected' },
    serialPortInfo,
    detectedControllerKind: null,
    statusReport: null,
    alarmCode: null,
  });
}

function dropLink(): void {
  useLaserStore.setState({ connection: { kind: 'disconnected' }, statusReport: null });
}

let uninstall = (): void => undefined;

beforeEach(() => {
  useLaserStore.setState(initialLaserState());
});

afterEach(() => {
  uninstall();
  useLaserStore.setState(initialLaserState());
});

describe('installLinkLossRestartTracking', () => {
  it('settles a run saved before the connection with its first answer', () => {
    const { repository, settle } = fakeRepository(lostLinkCapsule('saved'));
    uninstall = installLinkLossRestartTracking(repository);
    connect();
    useLaserStore.setState({ detectedControllerKind: 'grbl-v1.1' });
    // Later answers in the same connection change nothing.
    useLaserStore.setState({ statusReport: status('Idle') });
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith({ runId: 'saved', revision: 4 }, usb('boot-banner'));
  });

  it('settles the run that was live when the link dropped, though its record lands later', () => {
    const { repository, settle, save } = fakeRepository(null);
    uninstall = installLinkLossRestartTracking(repository);
    connect();
    useLaserStore.setState({ activeRunId: 'dropped', statusReport: status('Idle') });
    dropLink();
    connect();
    useLaserStore.setState({ statusReport: status('Alarm') });
    expect(settle).not.toHaveBeenCalled();
    save(lostLinkCapsule('dropped'));
    expect(settle).toHaveBeenCalledWith({ runId: 'dropped', revision: 4 }, usb('alarm'));
  });

  it('keeps the first answer: a banner after an inconclusive status does not invent a restart verdict', () => {
    const { repository, settle } = fakeRepository(lostLinkCapsule('saved'));
    uninstall = installLinkLossRestartTracking(repository);
    connect();
    useLaserStore.setState({ statusReport: status('Idle') });
    useLaserStore.setState({ detectedControllerKind: 'grbl-v1.1' });
    expect(settle).toHaveBeenCalledWith({ runId: 'saved', revision: 4 }, usb('unknown'));
  });

  it('reads past a grblHAL Telnet greeting to the first status (D7-P2-1)', () => {
    const { repository, settle } = fakeRepository(lostLinkCapsule('saved'));
    uninstall = installLinkLossRestartTracking(repository);
    connect(TCP);
    // grblHAL greets every new Telnet client, also one that reconnects to a
    // board that never reset.
    useLaserStore.setState({ detectedControllerKind: 'grblhal' });
    expect(settle).not.toHaveBeenCalled();
    useLaserStore.setState({ statusReport: status('Idle') });
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith({ runId: 'saved', revision: 4 }, network('unknown'));
  });

  it('settles a greeted reconnect to a board still running its planner as kept running', () => {
    const { repository, settle } = fakeRepository(lostLinkCapsule('saved'));
    uninstall = installLinkLossRestartTracking(repository);
    connect(TCP);
    useLaserStore.setState({ detectedControllerKind: 'grblhal' });
    useLaserStore.setState({ statusReport: status('Run') });
    expect(settle).toHaveBeenCalledWith({ runId: 'saved', revision: 4 }, network('kept-running'));
  });

  it('does not read a connection that was already open at install', () => {
    connect();
    const { repository, settle } = fakeRepository(lostLinkCapsule('saved'));
    uninstall = installLinkLossRestartTracking(repository);
    useLaserStore.setState({ detectedControllerKind: 'grbl-v1.1' });
    expect(settle).not.toHaveBeenCalled();
  });

  it('leaves a record saved during the connection, and CNC records, to their own verdicts', () => {
    const { repository, settle, save } = fakeRepository(null);
    uninstall = installLinkLossRestartTracking(repository);
    connect();
    useLaserStore.setState({ detectedControllerKind: 'grbl-v1.1' });
    save(lostLinkCapsule('this-connection'));
    save(lostLinkCapsule('saved-cnc', 'cnc'));
    expect(settle).not.toHaveBeenCalled();
  });

  // CNC audit v3 N5r-P1-1 (ADR-215 Amendment 4): a CNC record, an Abort's
  // included, takes every later connection's sign for "Position retained".
  it('records each connection’s sign on a CNC record saved before it', () => {
    const aborted = {
      ...lostLinkCapsule('aborted-cnc', 'cnc'),
      interruption: { kind: 'cancelled', message: 'Stopped by the operator (Abort).' },
    } as unknown as RecoveryCapsule;
    const { repository, settle } = fakeRepository(aborted);
    uninstall = installLinkLossRestartTracking(repository);
    connect();
    useLaserStore.setState({ detectedControllerKind: 'grbl-v1.1' });
    expect(settle).toHaveBeenCalledWith(
      { runId: 'aborted-cnc', revision: 4 },
      usb('boot-banner'),
      'cnc-restart',
    );
    useLaserStore.setState({ statusReport: status('Idle') });
    expect(settle).toHaveBeenCalledTimes(1);
    dropLink();
    connect();
    useLaserStore.setState({ statusReport: status('Idle') });
    expect(settle).toHaveBeenCalledTimes(2);
    expect(settle).toHaveBeenLastCalledWith(
      { runId: 'aborted-cnc', revision: 4 },
      usb('unknown'),
      'cnc-restart',
    );
  });
});

describe('linkLossRestartEvidence', () => {
  const quiet = {
    connection: { kind: 'connected' } as const,
    serialPortInfo: null,
    activeControllerKind: 'grbl-v1.1' as const,
    detectedControllerKind: null,
    alarmCode: null,
    statusReport: null,
  };

  it('reads a banner, an alarm, a status report, or nothing yet', () => {
    expect(linkLossRestartEvidence(quiet)).toBeNull();
    expect(linkLossRestartEvidence({ ...quiet, detectedControllerKind: 'grbl-v1.1' })).toEqual(
      usb('boot-banner'),
    );
    expect(linkLossRestartEvidence({ ...quiet, statusReport: status('Alarm') })).toEqual(
      usb('alarm'),
    );
    expect(linkLossRestartEvidence({ ...quiet, alarmCode: 1 })).toEqual(usb('alarm'));
    expect(linkLossRestartEvidence({ ...quiet, statusReport: status('Idle') })).toEqual(
      usb('unknown'),
    );
    expect(
      linkLossRestartEvidence({
        ...quiet,
        connection: { kind: 'disconnected' },
        statusReport: status('Idle'),
      }),
    ).toBeNull();
  });

  it.each(['Idle', 'Door', 'Jog'] as const)(
    'keeps a quiet USB reconnect in %s unknown instead of asserting continuity',
    (state) => {
      expect(linkLossRestartEvidence({ ...quiet, statusReport: status(state) })).toEqual(
        usb('unknown'),
      );
    },
  );

  it.each(['Run', 'Hold'] as const)('accepts active USB planner evidence in %s', (state) => {
    expect(linkLossRestartEvidence({ ...quiet, statusReport: status(state) })).toEqual(
      usb('kept-running'),
    );
  });

  it('still reads a stock GRBL banner on USB as a restart', () => {
    // An Arduino-class board resets when its port opens, then greets.
    const greeted = { ...quiet, serialPortInfo: { usbVendorId: 0x1a86 } };
    expect(linkLossRestartEvidence({ ...greeted, detectedControllerKind: 'grbl-v1.1' })).toEqual(
      usb('boot-banner'),
    );
    expect(linkLossRestartEvidence({ ...greeted, detectedControllerKind: 'fluidnc' })).toEqual(
      usb('boot-banner'),
    );
  });

  it('waits for the status after a banner that may be a greeting', () => {
    const tcp = { ...quiet, serialPortInfo: TCP, detectedControllerKind: 'grblhal' as const };
    expect(linkLossRestartEvidence(tcp)).toBeNull();
    expect(linkLossRestartEvidence({ ...tcp, statusReport: status('Idle') })).toEqual(
      network('unknown'),
    );
    expect(linkLossRestartEvidence({ ...tcp, statusReport: status('Hold') })).toEqual(
      network('kept-running'),
    );
    expect(linkLossRestartEvidence({ ...tcp, statusReport: status('Door') })).toEqual(
      network('unknown'),
    );
    expect(linkLossRestartEvidence({ ...tcp, statusReport: status('Alarm') })).toEqual(
      network('alarm'),
    );
  });

  it('cannot see a network restart without a banner either', () => {
    // FluidNC greets no Telnet client; one that restarted printed its banner
    // before its Wi-Fi was up.
    const tcp = { ...quiet, serialPortInfo: TCP, activeControllerKind: 'fluidnc' as const };
    expect(linkLossRestartEvidence({ ...tcp, statusReport: status('Idle') })).toEqual(
      network('unknown'),
    );
    expect(linkLossRestartEvidence({ ...tcp, statusReport: status('Run') })).toEqual(
      network('kept-running'),
    );
  });

  it('reads a grblHAL USB greeting by the status that follows it (D7-R1)', () => {
    const hal = {
      ...quiet,
      serialPortInfo: NATIVE_USB,
      activeControllerKind: 'grblhal' as const,
    };
    const greeted = { ...hal, detectedControllerKind: 'grblhal' as const };
    expect(linkLossRestartEvidence(greeted)).toBeNull();
    expect(linkLossRestartEvidence({ ...greeted, statusReport: status('Idle') })).toEqual(
      usb('unknown'),
    );
    expect(linkLossRestartEvidence({ ...greeted, statusReport: status('Run') })).toEqual(
      usb('kept-running'),
    );
    // A grblHAL build reporting itself as "Grbl 1.1f" greets the same way.
    expect(
      linkLossRestartEvidence({
        ...hal,
        detectedControllerKind: 'grbl-v1.1',
        statusReport: status('Idle'),
      }),
    ).toEqual(usb('unknown'));
    // Missing a USB startup banner does not prove the board never reset.
    expect(linkLossRestartEvidence({ ...hal, statusReport: status('Idle') })).toEqual(
      usb('unknown'),
    );
  });
});
