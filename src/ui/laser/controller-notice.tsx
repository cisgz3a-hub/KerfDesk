import { useCallback, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { assertNever } from '../../core/scene';
import { AnchoredPopover } from '../common/AnchoredPopover';
import type { ControllerQualification } from '../state/laser-controller-qualification';
import type { ConnectionState } from '../state/laser-store';
import type { ConnectionBarProps as Props } from './ConnectionBar';
import { ControllerRecoveryToast } from './ControllerRecoveryToast';
import { ControllerToolbarNotice } from './ControllerToolbarNotice';

export type ControllerNotice = {
  readonly key: string | null;
  readonly briefHidden: boolean;
  readonly triggerRef: RefObject<HTMLButtonElement>;
  readonly toastCloseRef: RefObject<HTMLButtonElement>;
  readonly open: boolean;
  readonly focusOnOpen: boolean;
  readonly show: (() => void) | undefined;
  readonly close: () => void;
  readonly dismiss: () => void;
};

export function useControllerNotice(props: Props): ControllerNotice {
  const qualification = props.qualification;
  const key =
    props.connection.kind === 'connected' &&
    (qualification?.kind === 'failed' || qualification?.kind === 'qualifying')
      ? JSON.stringify([
          qualification.epoch,
          qualification.kind,
          qualification.kind === 'failed' ? qualification.message : qualification.phase,
        ])
      : null;
  const [notice, setNotice] = useState({ key, dismissed: true, focusOnOpen: false });
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  if (dismissedKey !== null && dismissedKey !== key) setDismissedKey(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const toastCloseRef = useRef<HTMLButtonElement>(null);
  // A new failure or a completed retry starts a fresh notice; readiness updates
  // for the same failure leave the user's dismissal intact.
  if (notice.key !== key) setNotice({ key, dismissed: true, focusOnOpen: false });
  const close = useCallback(() => {
    setNotice({ key, dismissed: true, focusOnOpen: false });
  }, [key]);
  const dismiss = useCallback(() => {
    setDismissedKey(key);
    close();
    triggerRef.current?.focus();
  }, [close, key]);
  return {
    key,
    briefHidden: dismissedKey === key,
    triggerRef,
    toastCloseRef,
    open: key !== null && !notice.dismissed,
    focusOnOpen: notice.focusOnOpen,
    show:
      key === null
        ? undefined
        : () => {
            setNotice({ key, dismissed: false, focusOnOpen: true });
            toastCloseRef.current?.focus();
          },
    close,
    dismiss,
  };
}

type QualificationNoticeProps = {
  readonly notice: ControllerNotice;
  readonly connection: ConnectionState;
  readonly qualification: ControllerQualification | undefined;
  readonly readBlockReason: string | null | undefined;
  readonly reconnectRecommended: boolean;
  readonly onRetry: (() => void) | undefined;
  readonly onReconnect: (() => void) | undefined;
  readonly disabled: boolean;
};

export function BriefQualificationNotice(
  props: Props & { readonly notice: ControllerNotice },
): JSX.Element | null {
  const qualification = props.qualification;
  // Reading settings after a reset, and a read that failed while the
  // controller still answers, stay in Controller info: the machine works
  // without them. Only a controller that stopped answering announces itself
  // (ADR-607).
  if (
    props.notice.key === null ||
    props.notice.briefHidden ||
    props.notice.show === undefined ||
    qualification?.kind !== 'failed' ||
    props.controllerStoppedResponding !== true
  )
    return null;
  return (
    <ControllerToolbarNotice
      key={props.notice.key}
      focusFallbackRef={props.notice.triggerRef}
      message="Controller is not responding"
      detail={qualification.message}
      onShow={props.notice.show}
    />
  );
}

export function QualificationNotice(props: QualificationNoticeProps): JSX.Element | null {
  const id = useId();
  useControllerDetailsFocus(id, props.notice);
  if (!props.notice.open) return null;
  return (
    <AnchoredPopover
      id={id}
      label="Controller information"
      role="dialog"
      anchorRef={props.notice.triggerRef}
      className="lf-controller-info-popover"
      closeOnTab={false}
      onClose={props.notice.close}
    >
      <QualificationDetails {...props} />
    </AnchoredPopover>
  );
}

function useControllerDetailsFocus(id: string, notice: ControllerNotice): void {
  const { open, key, triggerRef } = notice;
  useLayoutEffect(() => {
    if (!open) return;
    const panel = document.getElementById(id);
    if (panel === null) return;
    const trigger = triggerRef.current;
    let lastFocused = panel.contains(document.activeElement) ? document.activeElement : null;
    const rememberFocus = (event: FocusEvent): void => {
      if (event.target instanceof Element) lastFocused = event.target;
    };
    panel.addEventListener('focusin', rememberFocus);
    return () => {
      panel.removeEventListener('focusin', rememberFocus);
      // A new qualification phase removes the requested details. Return only
      // focus owned by those details; an outside control keeps its own focus.
      if (
        panel.contains(document.activeElement) ||
        (lastFocused !== null &&
          !lastFocused.isConnected &&
          document.activeElement === document.body)
      ) {
        trigger?.focus();
      }
    };
  }, [id, key, open, triggerRef]);
}

function QualificationDetails(props: QualificationNoticeProps): JSX.Element | null {
  const qualification = props.qualification;
  if (props.connection.kind !== 'connected') return null;
  if (qualification === undefined || qualification.kind === 'disconnected') return null;
  if (qualification.kind === 'qualified') return null;
  if (qualification.kind === 'qualifying') {
    return (
      <div
        role="status"
        className="lf-controller-recovery-toast lf-controller-qualification-progress"
        aria-label="Controller information"
        title={props.readBlockReason ?? qualificationMessage(qualification.phase)}
      >
        {qualification.phase !== 'settings-read' && props.readBlockReason != null
          ? 'Waiting to read controller settings…'
          : qualificationMessage(qualification.phase)}
        {qualification.phase !== 'settings-read' && props.readBlockReason != null ? (
          <span> {props.readBlockReason}</span>
        ) : null}
        <button
          type="button"
          className="lf-btn"
          title="Close controller information"
          aria-label="Dismiss controller notification"
          onClick={props.notice.dismiss}
        >
          Close
        </button>
      </div>
    );
  }
  if (!props.notice.open) return null;
  return (
    <ControllerRecoveryToast
      closeRef={props.notice.toastCloseRef}
      onDismiss={props.notice.dismiss}
      focusOnOpen={props.notice.focusOnOpen}
      message={qualification.message}
      readBlockReason={props.readBlockReason}
      reconnectRecommended={props.reconnectRecommended}
      onRetry={props.onRetry}
      onReconnect={props.onReconnect}
      disabled={props.disabled}
    />
  );
}

function qualificationMessage(
  phase: Extract<ControllerQualification, { readonly kind: 'qualifying' }>['phase'],
): string {
  switch (phase) {
    case 'controller-response':
      return 'Waiting for controller response…';
    case 'reset-cleanup':
      return 'Controller reset detected. Waiting to read controller settings…';
    case 'settings-read':
      return 'Reading controller settings…';
    default:
      return assertNever(phase, 'ControllerQualificationPhase');
  }
}
