// ConnectionBar — the compact machine connection toolbar (ADR-420 Amendment 2):
// one status line, the machine it talks to, one primary action and a small
// menu for the rest.
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
import { CompactConnectionControls } from './CompactConnectionControls';
import './ConnectionBar.css';

type Props = {
  readonly connection: ConnectionState;
  readonly machineNoun: string;
  readonly onConnect: () => void;
  readonly onDisconnect: () => void;
  readonly onForget: () => void;
  readonly disabled: boolean;
  readonly qualification?: ControllerQualification;
  readonly qualificationReadBlockReason?: string | null;
  readonly reconnectRecommended?: boolean;
  readonly onRetryQualification?: () => void;
  readonly onReconnectQualification?: () => void;
  /** Show the port picker even when a remembered port is attached. */
  readonly onChoosePort?: () => void;
  readonly autoConnect?: boolean;
  readonly onAutoConnectChange?: (enabled: boolean) => void;
  /** The desktop app on macOS and Linux forgets its chosen ports when it closes (ADR-366). */
  readonly portChoiceEndsOnRestart?: boolean;
  /** The toolbar label; the full machine profile stays in the details popover. */
  readonly machineName?: string;
  /** Additional machine details, such as the fitted laser module. */
  readonly details?: ReactNode;
  /** The machine line: its name, work area and controller. */
  readonly machine?: ReactNode;
  /** The Machine Setup entry, beside the primary action. */
  readonly setup?: ReactNode;
  /** The Laser / CNC switch, first in the row. */
  readonly mode?: ReactNode;
};

export function ConnectionBar(props: Props): JSX.Element {
  const { connection } = props;
  return (
    <section
      className="lf-connection-compact"
      aria-label="Machine connection"
      data-state={connection.kind}
    >
      <CompactConnectionControls
        machineName={props.machineName ?? 'Unnamed machine'}
        status={connectionStatusLabel(connection)}
        statusDot={<StatusDot connection={connection} />}
        machine={props.machine}
        details={props.details}
        leading={props.mode}
      >
        <PrimaryAction {...props} />
        {props.setup}
        <ConnectionMenu {...props} />
      </CompactConnectionControls>
      {connection.kind === 'failed' && (
        <p role="alert" className="lf-connection-card-error">
          {connectionFailureText(connection.error, props.machineNoun)}
        </p>
      )}
      <QualificationNotice
        connection={connection}
        qualification={props.qualification}
        readBlockReason={props.qualificationReadBlockReason}
        reconnectRecommended={props.reconnectRecommended === true}
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
      title={connectTitle(props)}
    >
      {label}
    </button>
  );
}

function connectTitle(props: Props): string {
  return props.portChoiceEndsOnRestart === true
    ? `Connect to your ${props.machineNoun} controller. Choose its USB port the first time after KerfDesk starts; until KerfDesk closes, Connect uses that port.`
    : `Connect to your ${props.machineNoun} controller on the USB port it used last time. The first time, choose its port.`;
}

// Desktop picks on macOS and Linux last until KerfDesk closes (ADR-366), so the
// app there reconnects by itself only when the machine is plugged back in.
function autoConnectTitle(props: Props): string {
  return props.portChoiceEndsOnRestart === true
    ? `Connect by itself when the ${props.machineNoun} is plugged back in, to the port chosen since KerfDesk started. After each start, choose the port once with Connect. Connecting only reads settings; nothing moves.`
    : `Connect by itself when KerfDesk starts or the ${props.machineNoun} is plugged in, to the port it used last time. Connecting only reads settings; nothing moves.`;
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
              title={autoConnectTitle(props)}
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

type QualificationNoticeProps = {
  readonly connection: ConnectionState;
  readonly qualification: ControllerQualification | undefined;
  readonly readBlockReason: string | null | undefined;
  readonly reconnectRecommended: boolean;
  readonly onRetry: (() => void) | undefined;
  readonly onReconnect: (() => void) | undefined;
  readonly disabled: boolean;
};

function QualificationNotice(props: QualificationNoticeProps): JSX.Element | null {
  const qualification = props.qualification;
  if (props.connection.kind !== 'connected') return null;
  if (qualification === undefined || qualification.kind === 'disconnected') return null;
  if (qualification.kind === 'qualified') return null;
  if (qualification.kind === 'qualifying') {
    return (
      <div role="status" style={qualificationStyle}>
        {qualification.phase !== 'settings-read' && props.readBlockReason != null
          ? 'Waiting to read controller settings…'
          : qualificationMessage(qualification.phase)}
        {qualification.phase !== 'settings-read' && props.readBlockReason != null ? (
          <p style={qualificationMessageStyle}>{props.readBlockReason}</p>
        ) : null}
      </div>
    );
  }
  return (
    <div role="alert" className="lf-banner lf-banner--warning" style={qualificationErrorStyle}>
      <strong style={qualificationTitleStyle}>
        {props.reconnectRecommended
          ? 'Controller connection needs recovery'
          : 'Controller information unavailable'}
      </strong>
      <p style={qualificationMessageStyle}>{qualification.message}</p>
      {props.readBlockReason != null ? (
        <p role="status" style={qualificationMessageStyle}>
          Waiting to retry: {props.readBlockReason}
        </p>
      ) : null}
      <QualificationActions {...props} />
    </div>
  );
}

function QualificationActions(
  props: Pick<
    QualificationNoticeProps,
    'onRetry' | 'onReconnect' | 'disabled' | 'readBlockReason' | 'reconnectRecommended'
  >,
): JSX.Element {
  return (
    <div style={qualificationActionsStyle}>
      {props.onRetry !== undefined && (
        <button
          type="button"
          className="lf-btn"
          onClick={props.onRetry}
          disabled={props.disabled || props.readBlockReason !== null}
          title={
            props.readBlockReason ?? 'Read controller settings again using the current connection.'
          }
        >
          Retry reading controller settings
        </button>
      )}
      {props.reconnectRecommended && props.onReconnect !== undefined && (
        <button
          type="button"
          className="lf-btn"
          onClick={props.onReconnect}
          disabled={props.disabled}
          title="Close this controller connection and reconnect. This ends any paused job."
        >
          Reconnect controller
        </button>
      )}
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
      return 'Controller reset detected. Waiting to read controller settings…';
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
// Missing controller information is recoverable through the open connection.
// A transport problem supplies its own contextual reconnect recommendation.
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
