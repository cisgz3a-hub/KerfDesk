import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnchoredPopover } from '../common/AnchoredPopover';
import { Icon } from '../kit/icons';

type Props = {
  readonly machineName: string;
  readonly status: string;
  readonly statusDot: ReactNode;
  readonly machine?: ReactNode;
  readonly details?: ReactNode;
  /** Rendered before the machine name, such as the Laser / CNC switch. */
  readonly leading?: ReactNode;
  readonly children: ReactNode;
};

/** The everyday connection row; extended machine information opens in place. */
export function CompactConnectionControls(props: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const triggerId = `${popoverId}-trigger`;
  const statusId = `${popoverId}-status`;
  useRetainedDetailsFocus(open, popoverId);
  const close = useCallback(() => setOpen(false), []);
  const closeAndFocus = (): void => {
    close();
    triggerRef.current?.focus();
  };
  return (
    <>
      <div
        className="lf-connection-compact-row"
        onFocusCapture={(event) => {
          if (event.target instanceof HTMLElement && !triggerRef.current?.contains(event.target)) {
            event.target.dataset['dialogFocusFallback'] = triggerId;
          }
        }}
        onClickCapture={(event) => {
          if (event.target instanceof Node && !triggerRef.current?.contains(event.target)) close();
        }}
      >
        {props.leading === undefined ? null : (
          <div className="lf-connection-leading">{props.leading}</div>
        )}
        <button
          ref={triggerRef}
          id={triggerId}
          type="button"
          className="lf-btn lf-connection-machine-trigger"
          aria-label={`Machine details: ${props.machineName}`}
          aria-describedby={statusId}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          title={`${props.machineName} · ${props.status}. Show machine details and laser module.`}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }}
        >
          <MachineSummary {...props} statusId={statusId} />
        </button>
        <span className="lf-connection-status-live" role="status" aria-live="polite">
          {props.status}
        </span>
        {props.children}
      </div>
      {open ? (
        <AnchoredPopover
          id={popoverId}
          label="Machine details"
          role="dialog"
          anchorRef={triggerRef}
          focusFallbackId={triggerId}
          className="lf-connection-machine-popover"
          initialFocus="select:not(:disabled), button:not(:disabled)"
          closeOnTab={false}
          onClose={close}
          onKeyDown={isolateDetailsKey}
        >
          <div className="lf-connection-machine-popover-heading">
            <strong>Machine details</strong>
          </div>
          {props.machine ?? <strong>{props.machineName}</strong>}
          {props.details}
          <MachineDetailsCloseButton onClose={closeAndFocus} />
        </AnchoredPopover>
      ) : null}
    </>
  );
}

function MachineSummary(
  props: Pick<Props, 'machineName' | 'status' | 'statusDot'> & { readonly statusId: string },
): JSX.Element {
  return (
    <>
      {props.statusDot}
      <span className="lf-connection-machine-summary">
        <strong className="lf-connection-machine-name">{props.machineName}</strong>
        <span id={props.statusId} className="lf-connection-machine-status">
          {props.status}
        </span>
      </span>
      <Icon name="chevron-down" size={13} />
    </>
  );
}

function MachineDetailsCloseButton({ onClose }: { readonly onClose: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn lf-btn--ghost lf-connection-machine-popover-close"
      aria-label="Close machine details"
      title="Close machine details"
      onClick={onClose}
    >
      <Icon name="close" size={14} />
    </button>
  );
}

function isolateDetailsKey(event: React.KeyboardEvent<HTMLDivElement>): void {
  // Abort remains available from every control. All other keys belong to this
  // dialog; native select/typeahead/scroll defaults remain untouched.
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === '.') return;
  event.stopPropagation();
}

function useRetainedDetailsFocus(open: boolean, popoverId: string): void {
  useEffect(() => {
    if (!open) return;
    const panel = document.getElementById(popoverId);
    if (panel === null) return;
    let lastFocused = panel.contains(document.activeElement) ? document.activeElement : null;
    const rememberFocus = (event: FocusEvent): void => {
      if (event.target instanceof Element) lastFocused = event.target;
    };
    // Module controls can disappear from their own store subscription when a
    // profile or machine mode changes, without re-rendering this parent.
    const observer = new MutationObserver(() => {
      if (
        lastFocused === null ||
        lastFocused.isConnected ||
        document.activeElement !== document.body
      )
        return;
      const next = panel.querySelector<HTMLElement>('select:not(:disabled), button:not(:disabled)');
      (next ?? panel).focus();
    });
    panel.addEventListener('focusin', rememberFocus);
    observer.observe(panel, { childList: true, subtree: true });
    return () => {
      panel.removeEventListener('focusin', rememberFocus);
      observer.disconnect();
    };
  }, [open, popoverId]);
}
