// ConnectionBar — the compact machine connection toolbar (ADR-420 Amendment 2):
// one status line, the machine it talks to, one primary action and a small
// menu for the rest.
//
//   disconnected → "Not connected", primary "Connect"
//   connecting   → "Connecting…" (disabled)
//   connected    → "Connected", "Disconnect"; while its settings are read,
//                  "Connecting…" then "Reading settings…" (ADR-611 Amendment 2)
//   failed       → "Couldn't connect" with the reason, "Connect" to retry
//
// A background auto-connect that could not open the port stays "Not
// connected" with a quiet hint instead of the alert (ADR-639).
//
// Connect reuses the port the machine was on last time and asks for one only
// the first time; "Use a different port…" always asks. "Forget Controller"
// and "Connect automatically" live in the menu so the everyday row holds only
// the action that fits the state. machineNoun keeps the hover copy
// machine-aware ("laser" / "router", ADR-101 §7).

import { useId, useState, type ReactNode } from 'react';
import { assertNever } from '../../core/scene';
import { Icon } from '../kit/icons';
import { AnchoredPopover, movePopoverFocus } from '../common/AnchoredPopover';
import { isLinuxDesktop } from '../common/operating-system';
import type { ControllerQualification } from '../state/laser-controller-qualification';
import type { ConnectionState } from '../state/laser-store';
import { showConnectionHelp } from '../help/ConnectionHelpDialog';
import { CompactConnectionControls } from './CompactConnectionControls';
import { NoPortChosenHint, noPortChosen } from './NoPortChosenHint';
import {
  QualificationNotice,
  useControllerNotice,
  type ControllerNotice,
} from './controller-notice';
import { PORT_OPEN_NO_ANSWER } from '../state/port-open-no-answer';
import './ConnectionBar.css';

export type ConnectionBarProps = {
  readonly connection: ConnectionState;
  readonly machineNoun: string;
  readonly onConnect: () => void;
  readonly onDisconnect: () => void;
  readonly onForget: () => void;
  readonly disabled: boolean;
  readonly qualification?: ControllerQualification;
  readonly qualificationReadBlockReason?: string | null;
  readonly reconnectRecommended?: boolean;
  /** A controller that answered this session has gone quiet: "Not responding" (ADR-611 A1). */
  readonly controllerWentSilent?: boolean;
  /** The port opened but nothing has answered on it (U2-P3-3). */
  readonly controllerNeverAnswered?: boolean;
  /** The controller stopped answering status queries: Controller info titles it so (ADR-611 Amendment 2). */
  readonly controllerStoppedResponding?: boolean;
  readonly onRetryQualification?: () => void;
  readonly onReconnectQualification?: () => void;
  /** Show the port picker even when a remembered port is attached. */
  readonly onChoosePort?: () => void;
  readonly autoConnect?: boolean;
  readonly onAutoConnectChange?: (enabled: boolean) => void;
  /** The operator's Disconnect paused auto-connect until they Connect (ADR-639). */
  readonly autoConnectPaused?: boolean;
  /** Why the last automatic connect did not open the port, for a quiet hint (ADR-639). */
  readonly autoConnectSkipped?: string | null;
  /** Chosen ports last only until KerfDesk closes (ADR-366). */
  readonly portChoiceEndsOnRestart?: boolean;
  /** Only an adapter with a USB serial number is remembered across restarts: macOS and Linux,
   * in Chrome and the desktop app (ADR-607). */
  readonly portMemoryNeedsSerialNumber?: boolean;
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
  /** The live driver is not the saved profile's (U2-P2-1): say so, offer Reconnect now. */
  readonly driverMismatch?: { readonly text: string; readonly onReconnect: () => void } | undefined;
};

type Props = ConnectionBarProps;

/** The toolbar status line. A port that never heard the controller (U2-P3-3)
 * shows as quiet as one that went silent. */
function toolbarStatus(
  props: Props,
  silent: boolean,
): { readonly text: string; readonly quiet: boolean } {
  if (silent) return { text: 'Not responding', quiet: true };
  if (props.connection.kind === 'connected' && props.controllerNeverAnswered === true) {
    return { text: PORT_OPEN_NO_ANSWER, quiet: true };
  }
  return { text: connectionStatusText(props.connection, props.qualification), quiet: false };
}

export function ConnectionBar(props: Props): JSX.Element {
  const { connection } = props;
  const notice = useControllerNotice(props);
  const silent = connection.kind === 'connected' && props.controllerWentSilent === true;
  const status = toolbarStatus(props, silent);
  return (
    <section
      className="lf-connection-compact"
      aria-label="Machine connection"
      data-state={connection.kind}
      data-silent={silent ? 'true' : undefined}
    >
      <div className="lf-connection-toolbar-layout">
        {/* Keeps the controls at the trailing edge. A controller that needs
            recovery says so over the canvas instead of here (ADR-642). */}
        <div className="lf-connection-toolbar-spacer" />
        <div className="lf-connection-toolbar-controls">
          <CompactConnectionControls
            machineName={props.machineName ?? 'Unnamed machine'}
            status={status.text}
            statusDot={
              <StatusDot
                connection={connection}
                silent={status.quiet}
                qualifying={qualifyingPhase(connection, props.qualification) !== null}
              />
            }
            machine={props.machine}
            details={props.details}
            leading={props.mode}
          >
            <PrimaryAction {...props} />
            {props.setup}
            <ConnectionMenu {...props} notice={notice} />
          </CompactConnectionControls>
        </div>
      </div>
      <QualificationNotice
        connection={connection}
        qualification={props.qualification}
        readBlockReason={props.qualificationReadBlockReason}
        reconnectRecommended={props.reconnectRecommended === true}
        stoppedResponding={props.controllerStoppedResponding === true}
        onRetry={props.onRetryQualification}
        onReconnect={props.onReconnectQualification}
        disabled={props.disabled}
        notice={notice}
      />
      {props.driverMismatch === undefined ? null : (
        <p role="alert" className="lf-connection-driver-mismatch">
          <span>{props.driverMismatch.text}</span>{' '}
          <button
            type="button"
            className="lf-btn lf-btn--primary"
            title="Close the port and reconnect with this machine profile's commands. Nothing moves."
            disabled={props.disabled}
            onClick={props.driverMismatch.onReconnect}
          >
            Reconnect now
          </button>
        </p>
      )}
      {connection.kind === 'failed' && (
        <p role="alert" className="lf-connection-card-error">
          {connectionFailureText(connection.error, props.machineNoun)}
        </p>
      )}
      {noPortChosen(connection) ? (
        <NoPortChosenHint className="lf-connection-auto-hint" onHelp={showConnectionHelp} />
      ) : null}
      {connection.kind === 'disconnected' && props.autoConnectSkipped != null ? (
        <p className="lf-connection-auto-hint">
          {autoConnectSkippedText(props.autoConnectSkipped, props.machineNoun)}
        </p>
      ) : null}
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
  if (props.portChoiceEndsOnRestart === true)
    return `Connect to your ${props.machineNoun} controller. Choose its USB port the first time after KerfDesk starts; until KerfDesk closes, Connect uses that port.`;
  const remembered = `Connect to your ${props.machineNoun} controller on the USB port it used last time. The first time, choose its port.`;
  return props.portMemoryNeedsSerialNumber === true
    ? `${remembered} An adapter that reports no USB serial number (most CH340 boards) is chosen again after each start.`
    : remembered;
}

// Where picks last until KerfDesk closes (ADR-366), the app reconnects by
// itself only when the machine is plugged back in.
function autoConnectTitle(props: Props): string {
  if (props.portChoiceEndsOnRestart === true)
    return `Connect by itself when the ${props.machineNoun} is plugged back in, to the port chosen since KerfDesk started. After each start, choose the port once with Connect. Connecting only reads settings; nothing moves.`;
  const caveat =
    props.portMemoryNeedsSerialNumber === true
      ? ' An adapter with no USB serial number (most CH340 boards) connects by itself only after it is chosen once since KerfDesk started.'
      : '';
  return `Connect by itself when KerfDesk starts or the ${props.machineNoun} is plugged in, to the port it used last time.${caveat} Connecting only reads settings; nothing moves.`;
}

function ConnectionMenu(props: Props & { readonly notice: ControllerNotice }): JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = props.notice.triggerRef;
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
        title="Show controller info, choose another port, connect automatically, or forget this controller"
        onClick={() => {
          props.notice.close();
          setOpen((value) => !value);
        }}
      >
        <Icon name="more" size={16} />
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
          {props.notice.show === undefined ? null : (
            <MenuItem
              label="Controller info"
              title="Show controller information and connection recovery actions."
              onClick={() => run(props.notice.show ?? (() => undefined))}
            />
          )}
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
              label={
                props.autoConnect === true && props.autoConnectPaused === true
                  ? 'Connect automatically (paused until you connect)'
                  : 'Connect automatically'
              }
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
          <Icon name="check" size={15} />
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

type QualifyingPhase = Extract<ControllerQualification, { readonly kind: 'qualifying' }>['phase'];

function qualifyingPhase(
  connection: ConnectionState,
  qualification: ControllerQualification | undefined,
): QualifyingPhase | null {
  return connection.kind === 'connected' && qualification?.kind === 'qualifying'
    ? qualification.phase
    : null;
}

// The settings read after a connect or reset is progress, not news: it shows
// here beside the dot instead of in a notice (ADR-611 Amendment 2).
export function connectionStatusText(
  connection: ConnectionState,
  qualification: ControllerQualification | undefined,
): string {
  const phase = qualifyingPhase(connection, qualification);
  switch (phase) {
    case null:
      return connectionStatusLabel(connection);
    case 'controller-response':
      return 'Connecting…';
    case 'awaiting-ready':
      return 'Waiting for controller…';
    case 'reset-cleanup':
    case 'settings-read':
      return 'Reading settings…';
    default:
      return assertNever(phase, 'ControllerQualificationPhase');
  }
}

// Chromium's open() failure names no cause; the usual one is another program
// (LightBurn, a serial monitor, another KerfDesk tab) holding the port. Linux
// opens a serial port only for members of its serial group (dialout on Debian,
// Ubuntu and Fedora; uucp on Arch), and that refusal looks the same (ADR-607).
export function connectionFailureText(
  error: string,
  machineNoun: string,
  linux: boolean = isLinuxDesktop(),
): string {
  if (/failed to open serial port/i.test(error)) {
    const busy = `The port is busy or unavailable. Close any other program using the ${machineNoun} (another sender, a serial monitor, another KerfDesk window), then Connect again.`;
    return linux ? `${busy} ${LINUX_SERIAL_ACCESS}` : busy;
  }
  return error;
}

// The usual reason is the same busy port connectionFailureText explains, held
// by LightBurn, LaserGRBL or a serial monitor (ADR-639).
export function autoConnectSkippedText(reason: string, machineNoun: string): string {
  if (/failed to open serial port/i.test(reason)) {
    return `Didn’t connect by itself: the ${machineNoun}’s port is in use by another program. Close it, then Connect.`;
  }
  return `Didn’t connect by itself: ${reason}`;
}

const LINUX_SERIAL_ACCESS =
  'On Linux your account also needs serial access: run sudo usermod -aG dialout $USER (on Arch, uucp instead of dialout), then log out and back in.';

function StatusDot(props: {
  readonly connection: ConnectionState;
  readonly silent: boolean;
  readonly qualifying: boolean;
}): JSX.Element {
  const color =
    props.silent || props.qualifying
      ? 'var(--lf-warning)'
      : connectionStatusColor(props.connection);
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
