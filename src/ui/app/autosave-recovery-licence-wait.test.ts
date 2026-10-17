import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LicenceStatus } from '../../platform/types';
import {
  INITIAL_LICENCE_STATUS_TIMEOUT_MS,
  setActiveEdition,
  startLicensedEditionLocked,
  type EditionValue,
} from '../licensing/edition';
import type { AutosaveDurableSnapshot } from '../state/autosave-durable-read';
import { usePendingProProjectStore } from '../state/pending-pro-project';
import { resetStore } from '../state/test-helpers';
import { proProject } from './pro-project-test-fixtures';
import { runAutosaveRecovery } from './use-autosave';

const paid: LicenceStatus = {
  channel: 'commercial',
  edition: 'pro',
  state: 'ready',
  tier: 'paid',
  accessExpiresAt: null,
  updatesUntil: null,
  perpetualUpdates: false,
  licenseKey: null,
  deactivationPending: false,
  paymentPending: false,
  paymentOrderId: null,
  storeUnreadable: false,
  message: null,
};
const proEdition: EditionValue = {
  status: paid,
  licensed: true,
  pro: true,
  requestPro: () => true,
  openLicence: () => undefined,
};

function service() {
  const snapshot: AutosaveDurableSnapshot = {
    project: proProject(),
    savedAt: Date.now(),
    storageKey: 'autosave-test',
    backend: 'indexeddb',
    ownership: 'abandoned',
  };
  return {
    readLatest: vi.fn(async () => ({ snapshot, warnings: [], unreadable: [] })),
    retainRecovered: vi.fn(async () => undefined),
    write: vi.fn(async () => ({ kind: 'failed' as const })),
    clearRecovered: vi.fn(async () => ({ kind: 'ok' as const })),
  };
}

beforeEach(() => {
  resetStore();
  usePendingProProjectStore.setState({ pending: null });
  startLicensedEditionLocked();
});
afterEach(() => {
  setActiveEdition(null);
  vi.useRealTimers();
});

it('waits for the first licence status before judging an unsealed Pro autosave (ADR-592)', async () => {
  const recovery = service();
  const chooseRestore = vi.fn(() => null);
  const done = runAutosaveRecovery(chooseRestore, recovery as never);
  await vi.waitFor(() => expect(recovery.readLatest).toHaveBeenCalled());
  await Promise.resolve();
  expect(chooseRestore).not.toHaveBeenCalled();
  // The paying user's status arrives after the autosave was read.
  setActiveEdition(proEdition);
  await done;
  expect(chooseRestore).toHaveBeenCalledOnce();
  expect(recovery.retainRecovered).not.toHaveBeenCalled();
  expect(usePendingProProjectStore.getState().pending).toBeNull();
});

it('falls back to Free when the licence status never arrives', async () => {
  vi.useFakeTimers();
  const recovery = service();
  const chooseRestore = vi.fn(() => null);
  const done = runAutosaveRecovery(chooseRestore, recovery as never);
  await vi.advanceTimersByTimeAsync(INITIAL_LICENCE_STATUS_TIMEOUT_MS);
  await done;
  expect(chooseRestore).not.toHaveBeenCalled();
  expect(recovery.retainRecovered).toHaveBeenCalledOnce();
  expect(usePendingProProjectStore.getState().pending?.source).toBe('autosave');
});
