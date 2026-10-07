import type { CommercialUpdateStatus, LicenceAdapter } from '../../platform/types';

type Props = {
  readonly client: LicenceAdapter;
  readonly status: CommercialUpdateStatus;
  readonly busy: boolean;
  readonly onInstallOnQuit: () => Promise<void>;
  readonly onInstallAndClose?: (() => Promise<void>) | undefined;
};

/** Download consent and installation consent remain separate (ADR-561 Amendment 3). */
export function ManualUpdateInstallActions({
  client,
  status,
  busy,
  onInstallOnQuit,
  onInstallAndClose,
}: Props): JSX.Element | null {
  if (status.mode !== 'manual' || status.state !== 'ready') return null;
  return (
    <>
      {client.installUpdateAndClose !== undefined && onInstallAndClose !== undefined ? (
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          disabled={busy}
          onClick={() => void onInstallAndClose()}
          title="Verify the update, ask about unsaved changes, and close KerfDesk to open the installer. Active machine work keeps the app open."
        >
          Install and close KerfDesk
        </button>
      ) : null}
      {status.installOnQuit !== true ? (
        <button
          type="button"
          className="lf-btn"
          disabled={busy || client.installUpdateOnQuit === undefined}
          onClick={() => void onInstallOnQuit()}
          title="Prepare the verified installer to open after you close KerfDesk normally. This does not close the app or interrupt a job."
        >
          Install when I close KerfDesk
        </button>
      ) : null}
    </>
  );
}
