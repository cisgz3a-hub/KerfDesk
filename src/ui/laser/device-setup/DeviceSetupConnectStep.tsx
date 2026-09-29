// Find my machine (ADR-420): the first thing on the Machine stage. It connects
// with the draft's controller contract, shows what the controller reported,
// and fills a new machine's setup from it (use-controller-auto-fill.ts).
// Identity and settings reads do not move the machine or change its settings.
// Setting up without connecting stays one click away.

import { useState } from 'react';
import { assertNever } from '../../../core/scene';
import { helpProps } from '../../help/help-topics';
import { Button } from '../../kit';
import type { DeviceSetupStepProps } from './device-setup-flow';
import { DeviceSetupConnectionOptions } from './DeviceSetupConnectionOptions';
import { DeviceSetupFoundMachine } from './DeviceSetupFoundMachine';
import { DeviceSetupUseDetectedController } from './DeviceSetupUseDetectedController';
import { findMachinePhase, type FindMachinePhase } from './find-machine-phase';
import { machineSetupControllerGuide } from './machine-setup-controller-guide';
import { useFindMachine, type FindMachineModel } from './use-find-machine';
import type { DeviceSetupAutomatic } from './use-controller-auto-fill';

type Props = DeviceSetupStepProps & {
  readonly automatic?: DeviceSetupAutomatic | undefined;
  readonly openOptions?: boolean;
};

export function DeviceSetupConnectStep(props: Props): JSX.Element {
  const model = useFindMachine(props.state, props.automatic);
  const [offline, setOffline] = useState(false);
  const phase = findMachinePhase(model, offline);
  return (
    <section className="lf-setup-find" aria-label="Find my machine" data-phase={phase.kind}>
      <div className="lf-setup-find-head">
        <h4>{phase.title}</h4>
        <p>{phase.detail}</p>
      </div>
      {phase.kind === 'found' ? (
        <DeviceSetupFoundMachine
          state={props.state}
          dispatch={props.dispatch}
          automatic={props.automatic}
        />
      ) : null}
      {model.driverMismatch || model.bannerDiffers ? (
        <ConnectionMismatch model={model} state={props.state} dispatch={props.dispatch} />
      ) : null}
      <FindActions model={model} phase={phase} onOffline={setOffline} />
      <details className="lf-setup-disclosure lf-setup-disclosure--nested" open={props.openOptions}>
        <summary title="Choose the controller firmware, baud rate, output dialect and streaming used to connect.">
          <span>Connection options</span>
          <small>
            {model.guide.label}
            {model.driver.capabilities.transport === 'serial' ? ` · ${model.baudRate} baud` : ''}
          </small>
        </summary>
        <div className="lf-setup-disclosure-body">
          <DeviceSetupConnectionOptions state={props.state} dispatch={props.dispatch} />
          <CommandContract guide={model.guide} />
        </div>
      </details>
    </section>
  );
}

function FindActions(props: {
  readonly model: FindMachineModel;
  readonly phase: FindMachinePhase;
  readonly onOffline: (offline: boolean) => void;
}): JSX.Element | null {
  const { model, phase } = props;
  switch (phase.kind) {
    case 'idle':
    case 'failed':
    case 'offline':
      return <StartActions {...props} failed={phase.kind === 'failed'} />;
    case 'silent':
      return (
        <div className="lf-setup-find-actions">
          <Button variant="primary" onClick={model.scan.start}>
            Try other speeds
          </Button>
          <ChoosePort model={model} />
          <Button variant="ghost" onClick={model.disconnect}>
            Disconnect
          </Button>
        </div>
      );
    case 'scanning':
      return (
        <div className="lf-setup-find-actions">
          <Button onClick={model.scan.stop}>Stop</Button>
        </div>
      );
    case 'found':
      return <FoundActions model={model} />;
    case 'connecting':
    case 'reading':
    case 'unsupported':
    case 'file-only':
      return null;
    default:
      return assertNever(phase.kind);
  }
}

function StartActions(props: {
  readonly model: FindMachineModel;
  readonly phase: FindMachinePhase;
  readonly failed: boolean;
  readonly onOffline: (offline: boolean) => void;
}): JSX.Element {
  const { model } = props;
  return (
    <div className="lf-setup-find-actions">
      <Button
        variant="primary"
        onClick={() => {
          props.onOffline(false);
          model.find();
        }}
        {...helpProps('control:laser.device-setup.connect')}
      >
        {props.failed ? 'Try again' : 'Find my machine'}
      </Button>
      {props.failed ? <ChoosePort model={model} /> : null}
      {props.phase.kind === 'idle' ? (
        <Button variant="ghost" onClick={() => props.onOffline(true)}>
          Set up without connecting
        </Button>
      ) : null}
    </div>
  );
}

function FoundActions({ model }: { readonly model: FindMachineModel }): JSX.Element {
  return (
    <div className="lf-setup-find-actions">
      <Button
        onClick={model.readAgain}
        disabled={
          model.driverMismatch ||
          model.laser.controllerOperation !== null ||
          (model.guide.identityCommands.length === 0 && model.guide.settingsCommands.length === 0)
        }
        {...helpProps('control:laser.device-setup.reread')}
      >
        Read again
      </Button>
      <ChoosePort model={model} />
      <Button variant="ghost" onClick={model.disconnect}>
        Disconnect
      </Button>
    </div>
  );
}

function ChoosePort({ model }: { readonly model: FindMachineModel }): JSX.Element {
  return (
    <Button
      onClick={model.choosePort}
      title="Show the port list and connect to the port you choose."
    >
      Use a different port…
    </Button>
  );
}

// A driver that differs is fixed by a reconnect. A banner that differs is not
// (the draft chose the driver), so that card offers only the draft change,
// whose other effects are listed before they apply (ADR-375).
function ConnectionMismatch(
  props: DeviceSetupStepProps & { readonly model: FindMachineModel },
): JSX.Element {
  const { model } = props;
  const detected = model.laser.detectedControllerKind;
  const reported =
    detected === null ? 'unknown firmware' : machineSetupControllerGuide(detected).label;
  const active = machineSetupControllerGuide(
    model.laser.activeControllerKind,
    model.laser.activeControllerCommandSet ?? undefined,
  ).label;
  return (
    <div role="alert" className="lf-setup-find-mismatch">
      {model.driverMismatch ? (
        <>
          <strong>The connection does not match this setup.</strong>
          <span>
            Connected as {active}; the controller reports {reported}; this setup uses{' '}
            {model.guide.label}.
          </span>
        </>
      ) : (
        <>
          <strong>The firmware banner differs from this setup.</strong>
          <span>
            Connected as {model.guide.label}, as this setup chose; the controller’s banner reports{' '}
            {reported}. Reconnecting with this setup hears the same banner. If this machine runs{' '}
            {reported}, use it in the draft.
          </span>
        </>
      )}
      <div className="lf-setup-find-actions">
        {model.driverMismatch ? (
          <Button variant="primary" onClick={model.reconnect}>
            Reconnect using selected profile
          </Button>
        ) : null}
        {detected !== null && detected !== model.controllerKind ? (
          <DeviceSetupUseDetectedController
            state={props.state}
            dispatch={props.dispatch}
            detected={detected}
          />
        ) : null}
      </div>
    </div>
  );
}

function CommandContract(props: { readonly guide: FindMachineModel['guide'] }): JSX.Element {
  const { guide } = props;
  const list = (commands: ReadonlyArray<string>): string =>
    commands.length === 0 ? 'Not available' : commands.join(', ');
  return (
    <details className="lf-setup-find-contract">
      <summary
        title={`Show the exact read, status, home, and configuration contract for ${guide.label}.`}
      >
        Commands and configuration used for {guide.label}
      </summary>
      <dl>
        <dt>Identify</dt>
        <dd>{list(guide.identityCommands)}</dd>
        <dt>Read / settle</dt>
        <dd>{list(guide.settingsCommands)}</dd>
        <dt>Status</dt>
        <dd>{guide.statusCommand ?? 'Not available'}</dd>
        <dt>Home</dt>
        <dd>{guide.homeCommand ?? 'Not available'}</dd>
        <dt>Configure in</dt>
        <dd>{guide.configurationSurface}</dd>
      </dl>
    </details>
  );
}
