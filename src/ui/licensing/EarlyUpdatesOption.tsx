import { useEffect, useState } from 'react';
import type { EarlyUpdates, LicenceAdapter } from '../../platform/types';
import { licenceMuted } from './LicenceControls';

/**
 * Help > Licence: whether this device takes new versions from the beta ring, a
 * few days before everyone else (ADR-541). Shown only where the desktop app
 * takes commercial updates; everywhere else it renders nothing.
 */
export function EarlyUpdatesOption({
  client,
}: {
  readonly client: LicenceAdapter;
}): JSX.Element | null {
  const [setting, setSetting] = useState<EarlyUpdates | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    client.earlyUpdates().then(
      (value) => {
        if (live) setSetting(value);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client]);
  if (setting === null || !setting.available) return null;
  const change = async (enabled: boolean): Promise<void> => {
    setSaving(true);
    setFailed(false);
    try {
      setSetting(await client.setEarlyUpdates(enabled));
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div style={{ margin: '16px 0 4px' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={setting.enabled}
          disabled={saving}
          onChange={(event) => void change(event.currentTarget.checked)}
          title="Take each new version as soon as it is released, before everyone else"
        />
        Get new versions early (beta)
      </label>
      <p style={{ ...licenceMuted, margin: '4px 0 0 24px' }}>
        New versions reach you a few days before everyone else, with less testing behind them.
      </p>
      {failed ? (
        <p role="status" style={{ margin: '4px 0 0 24px' }}>
          This setting could not be saved. Please try again.
        </p>
      ) : null}
    </div>
  );
}
