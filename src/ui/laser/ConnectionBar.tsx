// ConnectionBar — the machine connection card at the top of the machine rail
// (ADR-420): one status line, the machine it talks to, one primary action and
// a small menu for the rest.
//
//   disconnected → "Not connected", primary "Connect"
//   connecting   → "Connecting…" (disabled)
//   connected    → "Connected", "Disconnect"
//   failed       → "Couldn't connect" with the reason, "Connect" to retry
//
// Connect reuses the port the machine was on last time and asks for one only
// the first time; "Use a different port…" always asks. "Forget Controller"
// and "Connect automatically" live in the menu so the everyday row holds only
// the action that fits the state. machineNoun keeps the hover copy
// machine-aware ("laser" / "router", ADR-101 §7).

import { useId, useRef, useState, type ReactNode } from 'react';
import { assertNever } from '../../core/scene';
import { AnchoredPopover, movePopoverFocus } from '../common/AnchoredPopover';
import type { ControllerQualification } from '../state/laser-controller-qualification';
import type { ConnectionState } from '../state/laser-store';

type Props = {
  readonly connection: ConnectionState;
  readonly machineNoun: string;
  readonly onConnect: () => void;
  readonly onDisconnect: () => void;
  readonly onForget: () => void;
  readonly disabled: boolean;
  readonly qualification?: ControllerQualification;
  readonly onRetryQualification?: () => void;
  readonly onReconnectQualification?: () => void;
  /** Show the port picker even when a remembered port is attached. */
  readonly onChoosePort?: () => void;
  readonly autoConnect?: boolean;
  readonly onAutoConnectChange?: (enabled: boolean) => void;
  /** The machine line: its name, work area and controller. */
  readonly machine?: ReactNode;
  /** The Machine Setup entry, beside the primary action. */
  readonly setup?: ReactNode;
};

export function ConnectionBar(props: Props): JSX.Element {
  const { connection } = props;
  return (
    <section
      className="lf-connection-card"
      aria-label="Machine connection"
      data-state={connection.kind}
    >
      <div className="lf-connection-card-head">
        <StatusDot connection={connection} />
        <span className="lf-connection-card-status" role="status" aria-live="polite">
          {connectionStatusLabel(connection)}
        </span>
        <ConnectionMenu {...props} />
      </div>
      {props.machine}
      <div className="lf-connection-card-actions">
        <PrimaryAction {...props} />
        {props.setup}
      </div>
      {connection.kind === 'failed' && (
        <p role="alert" className="lf-connection-card-error">
          {connectionFailureText(connection.error, props.machineNoun)}
        </p>
      )}
      <QualificationNotice
        qualification={props.qualification}
        onRetry={props.onRetryQualification}
        onReconnect={props.onReconnectQualification}
        disabled={props.disabled}
      />
    </section>
  );
}

function PrimaryAction(props: Props): JSX.Element {
  switch (props.connection.kind) {
    case 'connected':
      return (
        <button
          type="button"
          className="lf-btn"
          onClick={props.onDisconnect}
          disabled={props.disabled}
          title={`Close the current ${props.machineNoun} serial connection but keep device permission.`}
        >
          Disconnect
        </button>
      );
    case 'connecting':
      return connectButton(props, 'Connecting…', true);
    case 'disconnected':
    case 'failed':
      return connectButton(props, 'Connect', props.disabled);
    default:
      return assertNever(props.connection, 'ConnectionState');
  }
}

function connectButton(props: Props, label: string, disabled: boolean): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn lf-btn--primary"
      onClick={props.onConnect}
      disabled={disabled}
      title={`Connect to your ${props.machineNoun} controller on the USB port it used last time. The first time, choose its port.`}
    >
      {label}
    </button>
  );
}

function ConnectionMenu(props: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = (): void => setOpen(false);
  const run = (action: () => void): void => {
    close();
    triggerRef.current?.focus();
    action();
  };
  const connected = props.connection.kind === 'connected';
  const connecting = props.connection.kind === 'connecting';
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="lf-btn lf-btn--ghost lf-connection-card-more"
        aria-label="More connection options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Choose another port, connect automatically, or forget this controller"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <AnchoredPopover
          id={menuId}
          label="Connection options"
          role="menu"
          anchorRef={triggerRef}
          className="lf-connection-menu"
          onClose={close}
          onKeyDown={movePopoverFocus}
        >
          {props.onChoosePort === undefined ? null : (
            <MenuItem
              label="Use a different port…"
              title={`Show the port list and connect to the ${props.machineNoun} on the port you choose.`}
              disabled={props.disabled || connecting}
              onClick={() => run(props.onChoosePort ?? (() => undefined))}
            />
          )}
          {props.onAutoConnectChange === undefined ? null : (
            <MenuItem
              label="Connect automatically"
              title={`Connect by itself when KerfDesk starts or the ${props.machineNoun} is plugged in, to the port it used last time. Connecting only reads settings; nothing moves.`}
              checked={props.autoConnect === true}
              onClick={() => run(() => props.onAutoConnectChange?.(props.autoConnect !== true))}
            />
          )}
          {connected ? (
            <MenuItem
              label="Forget Controller"
              title={`Disconnect and remove this ${props.machineNoun} from the permitted devices. The next Connect asks for a port.`}
              disabled={props.disabled}
              onClick={() => run(props.onForget)}
            />
          ) : null}
        </AnchoredPopover>
      ) : null}
    </>
  );
}

function MenuItem(props: {
  readonly label: string;
  readonly title: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly checked?: boolean;
}): JSX.Element {
  const checkable = props.checked !== undefined;
  return (
    <button
      type="button"
      role={checkable ? 'menuitemcheckbox' : 'menuitem'}
      className="lf-connection-menu-item"
      aria-checked={checkable ? props.checked : undefined}
      title={props.title}
      disabled={props.disabled}
      tabIndex={-1}
      onClick={props.onClick}
    >
      <span>{props.label}</span>
      {checkable ? (
        <span className="lf-connection-menu-check" aria-hidden="true">
          ✓
        </span>
      ) : null}
    </button>
  );
}

export function connectionStatusLabel(connection: ConnectionState): string {
  switch (connection.kind) {
    case 'disconnected':
      return 'Not connected';
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'Connected';
    case 'failed':
      return 'Couldn’t connect';
    default:
      return assertNever(connection, 'ConnectionState');
  }
}

// Chromium's open() failure names no cause; the usual one is another program
// (LightBurn, a serial monitor, another KerfDesk tab) holding the port.
export function connectionFailureText(error: string, machineNoun: string): string {
  if (/failed to open serial port/i.test(error)) {
    return `The port is busy or unavailable. Close any other program using the ${machineNoun} (another sender, a serial monitor, another KerfDesk window), then Connect again.`;
  }
  return error;
}

function QualificationNotice(props: {
  readonly qualification: ControllerQualification | undefined;
  readonly onRetry: (() => void) | undefined;
  readonly onReconnect: (() => void) | undefined;
  readonly disabled: boolean;
}): JSX.Element | null {
  const qualification = props.qualification;
  if (qualification === undefined || qualification.kind === 'disconnected') return null;
  if (qualification.kind === 'qualified') return null;
  if (qualification.kind === 'qualifying') {
    return (
      <div role="status" style={qualificationStyle}>
        {qualificationMessage(qualification.phase)}
      </div>
    );
  }
  return (
    <div role="alert" className="lf-banner lf-banner--warning" style={qualificationErrorStyle}>
      <strong style={qualificationTitleStyle}>Controller qualification failed</strong>
      <p style={qualificationMessageStyle}>{qualification.message}</p>
      <div style={qualificationActionsStyle}>
        {props.onRetry !== undefined && (
          <button
            type="button"
            className="lf-btn"
            onClick={props.onRetry}
            disabled={props.disabled}
            title="Retry the owned controller settings read for this connection."
          >
            Retry reading controller settings
          </button>
        )}
        {props.onReconnect !== undefined && (
          <button
            type="button"
            className="lf-btn"
            onClick={props.onReconnect}
            disabled={props.disabled}
            title="Close this controller connection and reconnect for fresh qualification."
          >
            Reconnect controller
          </button>
        )}
      </div>
    </div>
  );
}

function qualificationMessage(
  phase: Extract<ControllerQualification, { readonly kind: 'qualifying' }>['phase'],
): string {
  switch (phase) {
    case 'controller-response':
      return 'Waiting for controller response…';
    case 'reset-cleanup':
      return 'Controller reset detected. Waiting for fresh Idle before reading settings…';
    case 'settings-read':
      return 'Reading controller settings…';
    default:
      return assertNever(phase, 'ControllerQualificationPhase');
  }
}

function StatusDot({ connection }: { readonly connection: ConnectionState }): JSX.Element {
  const color = connectionStatusColor(connection);
  return (
    <span
      aria-hidden="true"
      style={{
        flexShrink: 0,
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: 5,
        background: color,
      }}
    />
  );
}

function connectionStatusColor(connection: ConnectionState): string {
  switch (connection.kind) {
    case 'connected':
      return 'var(--lf-success)';
    case 'connecting':
      return 'var(--lf-warning)';
    case 'failed':
      return 'var(--lf-danger)';
    case 'disconnected':
      return 'var(--lf-text-faint)';
    default:
      return assertNever(connection, 'ConnectionState');
  }
}

const qualificationStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
};
// A failed qualification is recoverable in place, so it wears the shared
// warning banner rather than raw red text with bare inline buttons.
const qualificationErrorStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  fontSize: 11,
};
const qualificationTitleStyle: React.CSSProperties = { fontSize: 12 };
const qualificationMessageStyle: React.CSSProperties = { margin: 0, lineHeight: 1.45 };
const qualificationActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
};
