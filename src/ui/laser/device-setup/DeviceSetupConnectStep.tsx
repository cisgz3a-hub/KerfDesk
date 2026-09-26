// Find my machine (ADR-420): the first thing on the Machine stage. It connects
// with the draft's controller contract, shows what the controller reported,
// and fills a new machine's setup from it (use-controller-auto-fill.ts).
// Identity and settings reads do not move the machine or change its settings.
// Setting up without connecting stays one click away.

import { useState } from 'react';
import type { ControllerKind } from '../../../core/devices';
import { assertNever } from '../../../core/scene';
import { helpProps } from '../../help/help-topics';
import { Button } from '../../kit';
import type { DeviceSetupStepProps } from './device-setup-flow';
import { DeviceSetupConnectionOptions } from './DeviceSetupConnectionOptions';
import { DeviceSetupFoundMachine } from './DeviceSetupFoundMachine';
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
      {model.mismatch ? <ConnectionMismatch model={model} dispatch={props.dispatch} /> : null}
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
      return <StartActions model={model} failed={phase.kind === 'failed'} {...props} />;
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
          model.mismatch ||
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

function ConnectionMismatch(props: {
  readonly model: FindMachineModel;
  readonly dispatch: DeviceSetupStepProps['dispatch'];
}): JSX.Element {
  const { model } = props;
  const detected = model.laser.detectedControllerKind;
  const label = (kind: ControllerKind): string => machineSetupControllerGuide(kind).label;
  return (
    <div role="alert" className="lf-setup-find-mismatch">
      <strong>The connection does not match this setup.</strong>
      <span>
        Connected as {label(model.laser.activeControllerKind)}; the controller reports{' '}
        {detected === null ? 'unknown firmware' : label(detected)}; this setup uses{' '}
        {model.guide.label}.
      </span>
      <div className="lf-setup-find-actions">
        <Button variant="primary" onClick={model.reconnect}>
          Reconnect using selected profile
        </Button>
        {detected !== null && detected !== model.controllerKind ? (
          <Button
            onClick={() => props.dispatch({ kind: 'select-controller', controllerKind: detected })}
          >
            Use detected {label(detected)} in draft
          </Button>
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
