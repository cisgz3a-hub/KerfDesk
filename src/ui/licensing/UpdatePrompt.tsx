// ADR-561 Amendment 5: a card over the canvas when a desktop update is offered
// or ready, so the user can update without opening Help > Check for Updates.
// It is not a modal and blocks nothing. It waits while machine work or a modal
// dialog owns the window, and steps aside while the updates panel is open.
// Download and installation stay separate, explicit choices (ADR-561
// Amendment 3); Not now hides each stage until KerfDesk next starts.

import { useState } from 'react';
import type { CommercialUpdateStatus } from '../../platform/types';
import { Button } from '../kit';
import {
  useCommercialUpdateStore,
  type CommercialUpdateControls,
} from '../state/commercial-update-store';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';
import { machineWorkActive } from './machine-work-active';
import { updatePromptView, type UpdatePromptView } from './update-prompt-state';
import { CHECK_UPDATES_EVENT, updateStatusText } from './update-status-text';

type Action = (() => Promise<void>) | undefined;

type ShownView = Exclude<UpdatePromptView, { readonly kind: 'hidden' }>;

type BodyProps = {
  readonly view: ShownView;
  readonly status: CommercialUpdateStatus;
  readonly controls: CommercialUpdateControls;
  readonly busy: boolean;
  readonly run: (action: Action, after?: () => void) => void;
  readonly dismiss: () => void;
};

export function UpdatePrompt(): JSX.Element | null {
  const status = useCommercialUpdateStore((state) => state.status);
  const controls = useCommercialUpdateStore((state) => state.controls);
  const machineBusy = useLaserStore(machineWorkActive);
  const modalOpen = useUiStore((state) => state.modalDepth > 0);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [engaged, setEngaged] = useState(false);
  const view = updatePromptView({
    status,
    controls,
    blocked: machineBusy || modalOpen,
    dismissed,
    engaged,
  });
  if (view.kind === 'hidden' || status === null || controls === null) return null;
  const dismiss = (): void => {
    setDismissed((previous) => new Set(previous).add(view.key));
    setEngaged(false);
  };
  const run = (action: Action, after?: () => void): void => {
    if (action === undefined) return;
    setEngaged(true);
    void action().then(after);
  };
  const busy = controls.busy || status.state === 'checking' || status.state === 'downloading';
  const props = { view, status, controls, busy, run, dismiss };
  return (
    <section aria-label="KerfDesk update" style={cardStyle}>
      <strong style={headingStyle}>{HEADINGS[view.kind]}</strong>
      <PromptBody {...props} />
    </section>
  );
}

const HEADINGS: Record<ShownView['kind'], string> = {
  offer: 'Update available',
  downloading: 'Downloading update',
  ready: 'Update ready to install',
  failed: 'Update not finished',
};

function PromptBody(props: BodyProps): JSX.Element {
  switch (props.view.kind) {
    case 'offer':
      return <OfferBody {...props} view={props.view} />;
    case 'downloading':
      return <DownloadingBody {...props} />;
    case 'ready':
      return <ReadyBody {...props} view={props.view} />;
    case 'failed':
      return <FailedBody {...props} />;
  }
}

function OfferBody(
  props: BodyProps & { readonly view: Extract<ShownView, { kind: 'offer' }> },
): JSX.Element {
  const { view, status, controls, busy, run, dismiss } = props;
  return (
    <>
      <span>
        KerfDesk {view.version} is available. You have {status.currentVersion}.
      </span>
      {view.notes.length > 0 ? (
        <ul aria-label={`What's improved in KerfDesk ${view.version}`} style={notesStyle}>
          {view.notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      ) : null}
      <span style={actionsStyle}>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => run(controls.download)}
          title={`Download and verify KerfDesk ${view.version} while you keep working. You choose when to install it.`}
        >
          Update
        </Button>
        <NotNow onClick={dismiss} />
      </span>
    </>
  );
}

function DownloadingBody({ status, dismiss }: BodyProps): JSX.Element {
  const progress = status.downloadProgress;
  return (
    <>
      <span>{updateStatusText(status, null)}</span>
      {progress === undefined ? null : (
        <progress
          aria-label="Update download progress"
          max={progress.totalBytes}
          value={progress.receivedBytes}
          style={{ width: '100%' }}
        />
      )}
      <span style={actionsStyle}>
        <Button
          onClick={dismiss}
          title="Keep downloading in the background. This returns when the update is ready."
        >
          Hide
        </Button>
      </span>
    </>
  );
}

function ReadyBody(
  props: BodyProps & { readonly view: Extract<ShownView, { kind: 'ready' }> },
): JSX.Element {
  const { view, controls, busy, run, dismiss } = props;
  if (!view.manual)
    return (
      <>
        <span>KerfDesk {view.version} installs when you close KerfDesk.</span>
        <span style={actionsStyle}>
          <Button onClick={dismiss}>OK</Button>
        </span>
      </>
    );
  return (
    <>
      <span>
        {view.armed
          ? `KerfDesk ${view.version} installs after you close KerfDesk.`
          : `KerfDesk ${view.version} has downloaded and passed its checks.`}{' '}
        Install now asks about unsaved changes, then closes KerfDesk and opens the installer.
      </span>
      <span style={actionsStyle}>
        {controls.installAndClose === undefined ? null : (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => run(controls.installAndClose)}
            title="Verify the update, ask about unsaved changes, and close KerfDesk to open the installer. Active machine work keeps the app open."
          >
            Install now
          </Button>
        )}
        {controls.installOnQuit === undefined || view.armed ? null : (
          <Button
            disabled={busy}
            onClick={() =>
              run(controls.installOnQuit, () => {
                if (useCommercialUpdateStore.getState().status?.installOnQuit === true) dismiss();
              })
            }
            title="Open the installer after you close KerfDesk normally. This does not close the app or interrupt a job."
          >
            When I close
          </Button>
        )}
        <NotNow onClick={dismiss} />
      </span>
    </>
  );
}

function FailedBody({ status, controls, dismiss }: BodyProps): JSX.Element {
  return (
    <>
      <span>{controls.feedback ?? updateStatusText(status, null)}</span>
      <span style={actionsStyle}>
        <Button
          onClick={() => window.dispatchEvent(new Event(CHECK_UPDATES_EVENT))}
          title="Open Check for Updates"
        >
          Details
        </Button>
        <Button onClick={dismiss}>Dismiss</Button>
      </span>
    </>
  );
}

function NotNow({ onClick }: { readonly onClick: () => void }): JSX.Element {
  return (
    <Button
      onClick={onClick}
      title="Hide this until KerfDesk next starts. The status bar keeps the update button."
    >
      Not now
    </Button>
  );
}

// Top centre: the top right corner belongs to the machine setup card, the
// registration jig panel and the G-code bar; toasts and zoom sit at the bottom.
const cardStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 6,
  width: 360,
  maxWidth: 'calc(100% - 24px)',
  boxSizing: 'border-box',
  display: 'grid',
  gap: 8,
  padding: '10px 12px',
  border: '1px solid var(--lf-border)',
  borderLeft: '3px solid var(--lf-accent)',
  borderRadius: 6,
  background: 'var(--lf-bg-1)',
  boxShadow: 'var(--lf-shadow)',
  color: 'var(--lf-text)',
  fontSize: 12,
  lineHeight: 1.45,
};

const headingStyle: React.CSSProperties = { fontSize: 13 };

const notesStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  margin: 0,
  paddingLeft: 18,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};
