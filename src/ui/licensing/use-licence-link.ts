import { useCallback, useEffect, useState } from 'react';
import type { LicenceAdapter } from '../../platform/types';
import { LICENCE_SETTINGS_EVENT } from './edition';

/** The main process's data-free signal that a kerfdesk://licence link arrived (ADR-578). */
export const LICENCE_LINK_EVENT = 'kerfdesk:licence-link';

/**
 * Opens Help > Licence when the purchase page's "Copy key & open KerfDesk" link
 * launched or reached the app, with the key it copied already filled in. The
 * link is answered once, so a reload never reopens the panel. `serial` changes
 * per link so the panel starts fresh with that key.
 */
export function useLicenceLink(client: LicenceAdapter): {
  readonly linkedKey: string | null;
  readonly serial: number;
} {
  const [linked, setLinked] = useState({ linkedKey: null as string | null, serial: 0 });
  const check = useCallback(async (): Promise<void> => {
    if (client.licenceLink === undefined) return;
    try {
      const answer = await client.licenceLink();
      if (!answer.open) return;
      setLinked((current) => ({ linkedKey: answer.licenseKey, serial: current.serial + 1 }));
      window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT));
    } catch {
      /* The link is a convenience; Help > Licence still works. */
    }
  }, [client]);
  useEffect(() => {
    void check();
    const onLink = (): void => void check();
    window.addEventListener(LICENCE_LINK_EVENT, onLink);
    return () => window.removeEventListener(LICENCE_LINK_EVENT, onLink);
  }, [check]);
  return linked;
}
