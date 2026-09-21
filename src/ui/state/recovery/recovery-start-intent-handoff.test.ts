// ADR-337: the archive moved after the first wire byte, so the record that
// survives a crash inside the Start window is the intent. These tests pin the
// operator-facing consequence of that, not the mechanism: whatever the app
// managed to persist before it died, the next launch must still say the
// machine may have moved, and must say which program and how long it was.

import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { fingerprintGcode } from '../../../core/recovery';
import { DEFAULT_OUTPUT_SCOPE } from '../../../core/scene';
import { createStartIntent, START_INTENT_INTERRUPTION_MESSAGE } from './start-intent';
import {
  armFreshStartIntentMutation,
  reconcilePendingStartMutation,
} from './recovery-start-handoff-mutations';
import { emptyRecoverySlots, type PendingStartRecord } from './recovery-model';
import { parseRecoverySlots } from './recovery-model';

const NOW = '2026-09-21T09:00:00.000Z';
const LATER = '2026-09-21T09:00:20.000Z';
const GCODE = 'G21\nG90\nM4 S0\nG1 X10 Y10 S500\nG1 X20 Y10 S500\nM5\n';

function intent() {
  return createStartIntent({
    gcode: GCODE,
    machineKind: 'laser',
    outputScope: DEFAULT_OUTPUT_SCOPE,
    nowIso: NOW,
  });
}

describe('start intent handoff', () => {
  it('arms a fresh Start without a staged execution archive', () => {
    const armed = armFreshStartIntentMutation(emptyRecoverySlots(0), 'run-a', intent(), NOW);

    expect(armed.value).toBe(true);
    expect(armed.slots.pendingStart).toMatchObject({
      runId: 'run-a',
      kind: 'fresh',
      sendableLines: 6,
    });
    expect(armed.slots.pendingStart?.intent?.fingerprint).toEqual(fingerprintGcode(GCODE));
  });

  it('refuses to arm over an existing pending Start or active run', () => {
    const armed = armFreshStartIntentMutation(emptyRecoverySlots(0), 'run-a', intent(), NOW);
    const second = armFreshStartIntentMutation(armed.slots, 'run-b', intent(), NOW);

    expect(second.value).toBe(false);
    expect(second.slots.pendingStart?.runId).toBe('run-a');
  });

  it('reconciles an interrupted intent into a capsule that admits motion may have begun', () => {
    const armed = armFreshStartIntentMutation(emptyRecoverySlots(0), 'run-a', intent(), NOW);

    const reconciled = reconcilePendingStartMutation(armed.slots, LATER);

    expect(reconciled.value).toBe(true);
    expect(reconciled.slots.pendingStart).toBeNull();
    expect(reconciled.slots.recoveryCapsule).toMatchObject({
      runId: 'run-a',
      // Backed by the fingerprint-only stand-in, not by an archive that was
      // never written.
      artifactKind: 'legacy-fingerprint-only',
      ackedLines: 0,
      sendableLines: 6,
      interruption: { kind: 'unknown', message: START_INTENT_INTERRUPTION_MESSAGE },
    });
  });

  it('still reports an artifact-backed handoff as an exact execution', () => {
    const artifactArmed: PendingStartRecord = {
      runId: 'run-a',
      kind: 'fresh',
      sendableLines: 6,
      armedAtIso: NOW,
    };
    const slots = { ...emptyRecoverySlots(0), pendingStart: artifactArmed };

    expect(reconcilePendingStartMutation(slots, LATER).slots.recoveryCapsule).toMatchObject({
      artifactKind: 'exact-execution',
    });
  });

  it('round-trips an armed intent through the persisted slot parser', () => {
    const armed = armFreshStartIntentMutation(emptyRecoverySlots(0), 'run-a', intent(), NOW);

    const parsed = parseRecoverySlots(JSON.parse(JSON.stringify(armed.slots)), 0);

    expect(parsed.accepted).toBe(true);
    expect(parsed.slots.pendingStart?.intent).toEqual(armed.slots.pendingStart?.intent);
  });

  it('rejects a persisted intent whose length disagrees with the handoff', () => {
    const armed = armFreshStartIntentMutation(emptyRecoverySlots(0), 'run-a', intent(), NOW);
    const tampered = JSON.parse(JSON.stringify(armed.slots)) as {
      pendingStart: { sendableLines: number };
    };
    tampered.pendingStart.sendableLines = 5;

    // Half a durable Start record is worse than none: it would tell the
    // operator a program length nobody authorized.
    expect(parseRecoverySlots(tampered, 0).accepted).toBe(false);
  });

  it('rejects a malformed intent rather than reading it as a resumable run', () => {
    const armed = armFreshStartIntentMutation(emptyRecoverySlots(0), 'run-a', intent(), NOW);
    const tampered = JSON.parse(JSON.stringify(armed.slots)) as {
      pendingStart: { intent: { fingerprint: unknown } };
    };
    tampered.pendingStart.intent.fingerprint = { fnv1a: 'not-a-number', chars: 1, lines: 1 };

    expect(parseRecoverySlots(tampered, 0).accepted).toBe(false);
  });

  it('rejects an intent attached to a supervised recovery handoff', () => {
    const armed = armFreshStartIntentMutation(emptyRecoverySlots(0), 'run-a', intent(), NOW);
    const tampered = JSON.parse(JSON.stringify(armed.slots)) as {
      pendingStart: Record<string, unknown>;
    };
    tampered.pendingStart['kind'] = 'supervised-recovery';
    tampered.pendingStart['sourceRecovery'] = { runId: 'run-x', revision: 1, attemptId: 'a' };

    expect(parseRecoverySlots(tampered, 0).accepted).toBe(false);
  });
});
