import { useState } from 'react';
import type { ProjectOptimizationSettings } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';

export function OptimizationSettingsDialog(props: {
  readonly settings: ProjectOptimizationSettings;
  readonly onCancel: () => void;
  readonly onApply: (patch: ProjectOptimizationSettings) => void;
}): JSX.Element {
  const [settings, setSettings] = useState(props.settings);
  const update = (patch: Partial<ProjectOptimizationSettings>): void =>
    setSettings((current) => ({ ...current, ...patch }));
  return (
    <Dialog
      onClose={props.onCancel}
      title="Cut Planner"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onApply({
          ...settings,
          reduceTravelMoves: settings.travelPolicy === 'nearest-neighbor',
        });
      }}
      size="sm"
    >
      <PlannerFields settings={settings} update={update} />
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PlannerFields(props: {
  readonly settings: ProjectOptimizationSettings;
  readonly update: (patch: Partial<ProjectOptimizationSettings>) => void;
}): JSX.Element {
  const { settings, update } = props;
  return (
    <>
      <PlannerSelect
        label="Travel policy"
        name="travelPolicy"
        value={settings.travelPolicy}
        onChange={(travelPolicy) =>
          update({ travelPolicy: travelPolicy as ProjectOptimizationSettings['travelPolicy'] })
        }
        options={[
          ['nearest-neighbor', 'Reduce travel'],
          ['source-order', 'Keep source order'],
        ]}
      />
      <label style={checkboxRowStyle}>
        <input
          name="insideFirst"
          type="checkbox"
          className="lf-checkbox"
          checked={settings.insideFirst}
          title="Cut enclosed paths before their containing paths."
          onChange={(event) => update({ insideFirst: event.currentTarget.checked })}
        />
        <span>Inside paths first</span>
      </label>
      <PlannerSelect
        label="Layer priority"
        name="layerPriority"
        value={settings.layerPriority}
        onChange={(layerPriority) =>
          update({ layerPriority: layerPriority as ProjectOptimizationSettings['layerPriority'] })
        }
        options={[
          ['project-order', 'Cuts / Layers order'],
          ['reverse-project-order', 'Reverse layer order'],
        ]}
      />
      <PlannerSelect
        label="Path direction"
        name="pathDirection"
        value={settings.pathDirection}
        onChange={(pathDirection) =>
          update({ pathDirection: pathDirection as ProjectOptimizationSettings['pathDirection'] })
        }
        options={[
          ['allow-reverse', 'Choose nearest endpoint'],
          ['preserve', 'Preserve direction'],
        ]}
      />
      <PlannerSelect
        label="Planning start"
        name="startPoint"
        value={settings.startPoint}
        onChange={(startPoint) =>
          update({ startPoint: startPoint as ProjectOptimizationSettings['startPoint'] })
        }
        options={[
          ['machine-origin', 'Machine origin'],
          ['job-lower-left', 'Job lower-left'],
          ['job-center', 'Job center'],
        ]}
      />
    </>
  );
}

function PlannerSelect(props: {
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly options: ReadonlyArray<readonly [value: string, label: string]>;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label style={selectRowStyle}>
      <span>{props.label}</span>
      <select
        name={props.name}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
const selectRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(110px, 1fr) minmax(150px, 1.4fr)',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
