// Which connection's first answer settles which saved lost-link run
// (ADR-398 Amendment 3). The laser store is driven directly; the repository is
// a stand-in that records the settlements asked of it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
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

const status = (state: 'Idle' | 'Alarm'): StatusReport => ({ state }) as StatusReport;

function connect(): void {
  useLaserStore.setState({
    connection: { kind: 'connected' },
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
    expect(settle).toHaveBeenCalledWith({ runId: 'saved', revision: 4 }, 'boot-banner');
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
    expect(settle).toHaveBeenCalledWith({ runId: 'dropped', revision: 4 }, 'alarm');
  });

  it('keeps the first answer: a banner after a status report reads as kept running', () => {
    const { repository, settle } = fakeRepository(lostLinkCapsule('saved'));
    uninstall = installLinkLossRestartTracking(repository);
    connect();
    useLaserStore.setState({ statusReport: status('Idle') });
    useLaserStore.setState({ detectedControllerKind: 'grbl-v1.1' });
    expect(settle).toHaveBeenCalledWith({ runId: 'saved', revision: 4 }, 'kept-running');
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

  it('does not read a connection that was already open at install', () => {
    connect();
    const { repository, settle } = fakeRepository(lostLinkCapsule('saved'));
    uninstall = installLinkLossRestartTracking(repository);
    useLaserStore.setState({ detectedControllerKind: 'grbl-v1.1' });
    expect(settle).not.toHaveBeenCalled();
  });
});

describe('linkLossRestartEvidence', () => {
  const quiet = {
    connection: { kind: 'connected' } as const,
    detectedControllerKind: null,
    alarmCode: null,
    statusReport: null,
  };

  it('reads a banner, an alarm, a status report, or nothing yet', () => {
    expect(linkLossRestartEvidence(quiet)).toBeNull();
    expect(linkLossRestartEvidence({ ...quiet, detectedControllerKind: 'grbl-v1.1' })).toBe(
      'boot-banner',
    );
    expect(linkLossRestartEvidence({ ...quiet, statusReport: status('Alarm') })).toBe('alarm');
    expect(linkLossRestartEvidence({ ...quiet, alarmCode: 1 })).toBe('alarm');
    expect(linkLossRestartEvidence({ ...quiet, statusReport: status('Idle') })).toBe(
      'kept-running',
    );
    expect(
      linkLossRestartEvidence({
        ...quiet,
        connection: { kind: 'disconnected' },
        statusReport: status('Idle'),
      }),
    ).toBeNull();
  });
});
