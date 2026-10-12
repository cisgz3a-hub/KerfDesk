import { useState } from 'react';
import { Button, Dialog, DialogActions } from '../kit';
import { DESKTOP_DOWNLOAD_URL } from '../licensing/edition-policy';
import { requestProFeature } from '../licensing/edition';
import { PRO_FEATURES } from '../licensing/pro-features';
import { useLaserStore } from '../state/laser-store';
import { isActiveJobStatus } from '../state/laser-store-helpers';
import { usePendingProProjectStore, type PendingProProject } from '../state/pending-pro-project';
import { useToastStore } from '../state/toast-store';
import { usePlatform } from './platform-context';
import { savePreservedProProjectCopy } from './preserved-pro-project-copy';

export function ProProjectDesktopDialog(): JSX.Element | null {
  const pending = usePendingProProjectStore((state) => state.pending);
  const status = useLaserStore((state) => state.streamer?.status ?? null);
  if (pending === null) return null;
  // A surprise modal must never cover running-job controls. Keep the original
  // queued; the dialog can appear after the job is no longer active.
  if (isActiveJobStatus(status))
    return (
      <section role="status" aria-label="Project requires desktop" style={noticeStyle}>
        A project with Pro operations is preserved for the desktop app. Your current job continues.
      </section>
    );
  return pending.edition === 'desktop' ? (
    <DesktopProProjectDialog key={pending.id} pending={pending} />
  ) : (
    <PreservedProjectDialog key={pending.id} pending={pending} />
  );
}

function usePreservedCopy(pending: PendingProProject, savedMessage: string) {
  const platform = usePlatform();
  const pushToast = useToastStore((state) => state.pushToast);
  const [saving, setSaving] = useState(false);
  const save = (): void => {
    if (saving) return;
    setSaving(true);
    void savePreservedProProjectCopy(pending, platform)
      .then((result) => {
        if (result === 'saved') pushToast(savedMessage, 'success');
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        pushToast(`Could not save the preserved project: ${message}`, 'error');
      })
      .finally(() => setSaving(false));
  };
  return { saving, save };
}

/**
 * Desktop Free: the project holds Pro work that this computer did not save
 * (ADR-592). Unlocking Pro here lets the operator open it again.
 */
function DesktopProProjectDialog({
  pending,
}: {
  readonly pending: PendingProProject;
}): JSX.Element {
  const dismiss = usePendingProProjectStore((state) => state.dismiss);
  const copy = usePreservedCopy(pending, 'Saved a complete copy of the autosaved project.');
  const close = (): void => dismiss(pending);
  const unlock = (): void => {
    const feature = pending.features[0];
    close();
    if (feature !== undefined) requestProFeature(feature);
  };
  return (
    <Dialog
      title="This project needs KerfDesk Pro"
      onClose={close}
      size="sm"
      initialFocus="surface"
    >
      <p>
        {pending.name ??
          (pending.source === 'autosave' ? 'This autosaved project' : 'This project')}{' '}
        contains Pro operations that were not saved on this computer with KerfDesk Pro or its trial:
      </p>
      <ul aria-label="Project Pro features">
        {pending.features.map((feature) => (
          <li key={feature}>{PRO_FEATURES[feature].name}</li>
        ))}
      </ul>
      <p>
        {pending.source === 'autosave'
          ? 'Your current workspace is unchanged and the autosave stays in recovery storage. Save a copy, start the trial or enter your licence key, then open the copy.'
          : 'Your current workspace is unchanged and the file was not modified. Start the trial or enter your licence key, then open the project again.'}
      </p>
      <DialogActions>
        <Button variant="primary" onClick={unlock}>
          Unlock Pro
        </Button>
        {pending.source === 'autosave' ? (
          <Button onClick={copy.save} disabled={copy.saving}>
            {copy.saving ? 'Saving…' : 'Save preserved copy'}
          </Button>
        ) : null}
        <Button onClick={close}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function PreservedProjectDialog({ pending }: { readonly pending: PendingProProject }): JSX.Element {
  const dismiss = usePendingProProjectStore((state) => state.dismiss);
  const { saving, save } = usePreservedCopy(
    pending,
    'Saved a complete project copy for the desktop app.',
  );
  const close = (): void => dismiss(pending);
  return (
    <Dialog
      title="Open this project in the desktop app"
      onClose={close}
      size="sm"
      initialFocus="surface"
    >
      <p>
        {pending.name ??
          (pending.source === 'autosave' ? 'This autosaved project' : 'This project')}{' '}
        contains Pro operations that the browser Free edition cannot open:
      </p>
      <ul aria-label="Project Pro features">
        {pending.features.map((feature) => (
          <li key={feature}>{PRO_FEATURES[feature].name}</li>
        ))}
      </ul>
      <p>
        Your current workspace is unchanged. The complete original has been kept without removing
        any artwork or operations.
      </p>
      {pending.source === 'autosave' ? (
        <p>The original autosave remains in recovery storage. Save a copy to open it on desktop.</p>
      ) : null}
      <DialogActions>
        <a
          className="lf-btn lf-btn--primary"
          href={DESKTOP_DOWNLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Download desktop
        </a>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save preserved copy'}
        </Button>
        <Button onClick={close}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

const noticeStyle: React.CSSProperties = { padding: '4px 12px', fontSize: 12 };
