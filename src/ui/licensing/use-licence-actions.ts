import { useState, type FormEvent } from 'react';
import type { LicenceAdapter, LicenceStatus } from '../../platform/types';
import { findLicenceKey } from '../../../public/licence-key-text.mjs';

/**
 * One licence action at a time, and the key being typed, for Help > Licence and
 * the window the desktop app opens behind (ADR-623).
 */
export function useLicenceActions(
  client: LicenceAdapter,
  onStatus: (status: LicenceStatus) => Promise<void>,
  initialKey: string,
) {
  const [key, setKey] = useState(initialKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<LicenceStatus>, activatedKey?: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await work();
      await onStatus(next);
      // Failures may resolve with cached rights. Only clear a confirmed matching
      // activation, never a rejected key or an unrelated licence action.
      if (
        activatedKey !== undefined &&
        next.state === 'ready' &&
        next.licenseKey === activatedKey &&
        next.message === null
      )
        setKey('');
    } catch {
      setError('This request could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const activate = (event: FormEvent): void => {
    event.preventDefault();
    const submitted = key.trim();
    // The app activates the key found in pasted text; that is the key it saves.
    void run(() => client.activate(submitted), findLicenceKey(submitted) ?? submitted);
  };
  return { key, setKey, busy, error, run, activate };
}
