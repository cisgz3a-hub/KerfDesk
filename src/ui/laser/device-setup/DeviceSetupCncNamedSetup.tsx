import type { CncMachiningSetup, CncSetupFixture } from '../../../core/scene/cnc-machining-setup';

/** Part of the Machine Setup draft: cancellation never writes the project. */
export function DeviceSetupCncNamedSetup(props: {
  readonly setup: CncMachiningSetup;
  readonly onChange: (setup: CncMachiningSetup) => void;
}): JSX.Element {
  const { setup, onChange } = props;
  const changeFixture = (id: string, patch: Partial<CncSetupFixture>): void =>
    onChange({
      ...setup,
      fixtures: setup.fixtures.map((fixture) =>
        fixture.id === id ? { ...fixture, ...patch } : fixture,
      ),
    });
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <label>
        Setup name{' '}
        <input
          title="Name this retained CNC setup"
          aria-label="CNC setup name"
          maxLength={120}
          value={setup.name}
          onChange={(event) => onChange({ ...setup, name: event.target.value })}
        />
      </label>
      <p>
        G54 work coordinates · Z zero at stock top. Stock and the tool plan below belong to this
        setup.
      </p>
      <label>
        Setup notes{' '}
        <textarea
          title="Record CNC setup and workholding notes"
          aria-label="CNC setup notes"
          maxLength={4000}
          value={setup.notes}
          onChange={(event) => onChange({ ...setup, notes: event.target.value })}
        />
      </label>
      <p>
        Describe clamps in the program’s G54 coordinates, after placement. Reach checks are advisory
        and do not verify the physical machine.
      </p>
      {setup.fixtures.map((fixture) => (
        <SetupFixtureEditor
          key={fixture.id}
          fixture={fixture}
          onChange={(patch) => changeFixture(fixture.id, patch)}
          onRemove={() =>
            onChange({
              ...setup,
              fixtures: setup.fixtures.filter((item) => item.id !== fixture.id),
            })
          }
        />
      ))}
      <button
        title="Add a fixture to the retained CNC setup"
        type="button"
        disabled={setup.fixtures.length >= 128}
        onClick={() =>
          onChange({ ...setup, fixtures: [...setup.fixtures, newFixture(setup.fixtures.length)] })
        }
      >
        Add fixture
      </button>
    </div>
  );
}

function SetupFixtureEditor(props: {
  readonly fixture: CncSetupFixture;
  readonly onChange: (patch: Partial<CncSetupFixture>) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const { fixture, onChange, onRemove } = props;
  return (
    <fieldset style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <legend>{fixture.name}</legend>
      <label>
        Fixture name{' '}
        <input
          title="Name this fixture"
          aria-label={`Fixture name ${fixture.id}`}
          maxLength={120}
          value={fixture.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </label>
      {FIXTURE_FIELDS.map(([key, label]) => (
        <label key={key}>
          {label} (mm){' '}
          <input
            title={label + ' in millimetres for ' + fixture.name}
            type="number"
            step="0.1"
            aria-label={`${fixture.name} ${label}`}
            value={fixture[key]}
            onChange={(event) => onChange({ [key]: event.target.valueAsNumber })}
            style={{ width: 85 }}
          />
        </label>
      ))}
      <button
        title={'Remove fixture ' + fixture.name + ' from this setup'}
        type="button"
        onClick={onRemove}
      >
        Remove {fixture.name}
      </button>
    </fieldset>
  );
}

function newFixture(count: number): CncSetupFixture {
  return {
    id: crypto.randomUUID(),
    name: `Clamp ${count + 1}`,
    xMm: 0,
    yMm: 0,
    widthMm: 20,
    heightMm: 20,
    bottomZMm: 0,
    topZMm: 15,
  };
}

const FIXTURE_FIELDS = [
  ['xMm', 'X'],
  ['yMm', 'Y'],
  ['widthMm', 'Width'],
  ['heightMm', 'Height'],
  ['bottomZMm', 'Bottom Z'],
  ['topZMm', 'Top Z'],
] as const;
