// ADR-561 Amendment 7: the desktop Update button at the right of the top
// toolbar. It appears once a desktop update is offered and updates from one
// click: an offered update downloads (or opens its verified download page on
// macOS and Linux), and a verified download asks once, then runs the existing
// guarded install-and-close (ADR-561 Amendment 3), which asks about unsaved
// work and refuses while machine work owns the window. It adds no update route
// and never closes the app by itself. While machine work runs it stays visible
// as "Update after job" and does nothing until the machine is idle.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AnchoredPopover } from '../common/AnchoredPopover';
import { Button } from '../kit';
import { Icon } from '../kit/icons';
import { useCommercialUpdateStore } from '../state/commercial-update-store';
import { useToastStore } from '../state/toast-store';
import type { CommercialUpdateStatus } from '../../platform/types';
import {
  toolbarUpdateGlows,
  toolbarUpdateLabel,
  toolbarUpdateTitle,
  toolbarUpdateView,
} from './toolbar-update-state';
import { updateInstallWaitsNow, useUpdateInstallWaits } from './update-install-waits';
import { CHECK_UPDATES_EVENT, updateStatusText } from './update-status-text';
import './toolbar-update.css';

export const UPDATE_WAITS_FOR_MACHINE =
  'Machine work is running, so the update cannot install now. Use Update again when the machine is idle.';

const openUpdatesPanel = (): void => {
  window.dispatchEvent(new Event(CHECK_UPDATES_EVENT));
};

export function ToolbarUpdateButton(): JSX.Element {
  const status = useCommercialUpdateStore((state) => state.status);
  const controls = useCommercialUpdateStore((state) => state.controls);
  const machineBusy = useUpdateInstallWaits();
  const [engaged, setEngaged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const triggerId = useId();
  const panelId = useId();
  const view = toolbarUpdateView({ status, controls, machineBusy, engaged });
  const closeConfirm = useCallback(() => setConfirming(false), []);
  // A job that starts, or a status that moves on, withdraws the question.
  useEffect(() => {
    if (view.kind !== 'install') setConfirming(false);
  }, [view.kind]);
  const installNow = (): void => {
    setConfirming(false);
    if (updateInstallWaitsNow()) {
      useToastStore.getState().pushToast(UPDATE_WAITS_FOR_MACHINE, 'warning');
      return;
    }
    setEngaged(true);
    void useCommercialUpdateStore.getState().controls?.installAndClose?.();
  };
  const busy = controls?.busy === true;
  const onClick = (): void => {
    if (view.kind === 'download') {
      if (busy) return;
      setEngaged(true);
      void controls?.download?.();
    } else if (view.kind === 'install') {
      if (!busy) setConfirming((open) => !open);
    } else if (view.kind !== 'waiting' && view.kind !== 'hidden') {
      openUpdatesPanel();
    }
  };
  return (
    <>
      {/* Mounted while empty so the reader hears the text change (see PwaUpdateButton). */}
      <span role="status" className="lf-visually-hidden-update">
        {announcement(status)}
      </span>
      {view.kind === 'hidden' ? null : (
        <button
          id={triggerId}
          ref={triggerRef}
          type="button"
          className="lf-btn lf-btn--primary lf-toolbar-command lf-toolbar-update"
          data-update-state={view.kind}
          data-glow={toolbarUpdateGlows(view) ? 'true' : undefined}
          aria-disabled={view.kind === 'waiting' || (busy && view.kind !== 'downloading')}
          aria-label={`${toolbarUpdateLabel(view)}: ${toolbarUpdateTitle(view)}`}
          {...(view.kind === 'install'
            ? {
                'aria-haspopup': 'dialog' as const,
                'aria-expanded': confirming,
                'aria-controls': confirming ? panelId : undefined,
              }
            : {})}
          title={toolbarUpdateTitle(view)}
          onClick={onClick}
        >
          <Icon name="download" size={14} />
          <span>{toolbarUpdateLabel(view)}</span>
        </button>
      )}
      {confirming && view.kind === 'install' ? (
        <InstallQuestion
          id={panelId}
          version={view.version}
          anchorRef={triggerRef}
          focusFallbackId={triggerId}
          onInstall={installNow}
          onClose={closeConfirm}
        />
      ) : null}
    </>
  );
}

function InstallQuestion(props: {
  readonly id: string;
  readonly version: string;
  readonly anchorRef: React.RefObject<HTMLButtonElement>;
  readonly focusFallbackId: string;
  readonly onInstall: () => void;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <AnchoredPopover
      id={props.id}
      label={`Install KerfDesk ${props.version}`}
      role="dialog"
      anchorRef={props.anchorRef}
      className="lf-toolbar-update-confirm"
      initialFocus="button"
      focusFallbackId={props.focusFallbackId}
      onClose={props.onClose}
    >
      <strong>Install KerfDesk {props.version} now?</strong>
      <p>
        KerfDesk asks you to save unsaved changes, then closes and opens the installer. Cancel keeps
        KerfDesk open.
      </p>
      <span className="lf-toolbar-update-confirm__actions">
        <Button variant="primary" onClick={props.onInstall}>
          Install now
        </Button>
        <Button onClick={props.onClose}>Not now</Button>
        <Button
          variant="ghost"
          onClick={() => {
            props.onClose();
            openUpdatesPanel();
          }}
        >
          Details…
        </Button>
      </span>
    </AnchoredPopover>
  );
}

/** The polite announcement the status bar's Update ready button used to make. */
function announcement(status: CommercialUpdateStatus | null): string {
  if (status === null || status.version === null) return '';
  return status.state === 'available' || status.state === 'ready'
    ? updateStatusText(status, null)
    : '';
}
