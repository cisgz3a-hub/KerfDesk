// Top of My machines: save the open project's machine, or write the project's
// copy back to the saved machine it came from. When a controller is connected
// the operator can also record what it reports, so the machine is recognised
// the next time it connects (ADR-374).

import { useState } from 'react';
import type { SavedMachine } from '../../core/saved-machines/saved-machine-list';
import { Button } from '../kit';
import { useStore } from '../state';
import { saveCurrentMachineAsNew, saveProjectCopyToSavedMachine } from './saved-machine-actions';
import { projectCopyDifferences } from './saved-machine-comparison';
import { useConnectedControllerFingerprint } from './use-connected-controller-fingerprint';

export function CurrentMachineSection(props: {
  readonly active: SavedMachine | undefined;
  readonly onReport: (text: string) => void;
}): JSX.Element {
  const device = useStore((state) => state.project.device);
  const fingerprint = useConnectedControllerFingerprint();
  const [remember, setRemember] = useState(true);
  const rememberController = fingerprint !== null && remember;
  const active = props.active;
  const saveNew = (): void => {
    const machine = saveCurrentMachineAsNew({ rememberController });
    props.onReport(`Saved “${machine.name}” to My machines. This project now uses it.`);
  };
  return (
    <section aria-label="Open project machine" style={sectionStyle}>
      <p style={textStyle}>{currentMachineText(device, active)}</p>
      <div style={actionsStyle}>
        {active === undefined ? (
          <Button
            variant="primary"
            title="Add the open project's complete machine profile to My machines."
            onClick={saveNew}
          >
            Save current machine
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              title={`Write the open project's machine settings over the saved “${active.name}”.`}
              onClick={() => {
                saveProjectCopyToSavedMachine(active.id, { rememberController });
                props.onReport(`Updated “${active.name}” from this project.`);
              }}
            >
              Save changes to saved machine
            </Button>
            <Button
              title="Add the open project's machine to My machines as a separate machine."
              onClick={saveNew}
            >
              Save as new machine
            </Button>
          </>
        )}
      </div>
      {fingerprint === null ? (
        <p style={noteStyle}>
          Connect the machine before saving to let KerfDesk recognise it when it connects.
        </p>
      ) : (
        <label style={noteStyle}>
          <input
            type="checkbox"
            checked={remember}
            title="Record what the connected controller reports, so KerfDesk can offer this machine when it connects again."
            onChange={(event) => setRemember(event.currentTarget.checked)}
          />{' '}
          Remember the connected controller so KerfDesk can recognise this machine
        </label>
      )}
    </section>
  );
}

function currentMachineText(
  device: ReturnType<typeof useStore.getState>['project']['device'],
  active: SavedMachine | undefined,
): string {
  if (active === undefined) {
    return `The open project's machine “${device.name}” is not in My machines.`;
  }
  const differences = projectCopyDifferences(device, active.profile);
  return differences.length === 0
    ? `This project uses your saved machine “${active.name}”, and its copy matches.`
    : `This project uses your saved machine “${active.name}”. Its copy differs in: ${differences.join(', ')}.`;
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 10,
  marginBottom: 8,
  border: '1px solid var(--lf-border)',
  borderRadius: 'var(--lf-radius-md)',
  background: 'var(--lf-bg-1)',
};
const textStyle: React.CSSProperties = { margin: 0 };
const noteStyle: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--lf-text-muted)' };
const actionsStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };
