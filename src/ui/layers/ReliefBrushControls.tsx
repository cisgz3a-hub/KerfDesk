import type { SceneObject } from '../../core/scene/scene-object';
import type { ReliefSculptStroke } from '../../core/scene/relief/relief-authoring';
import { NumberControl } from './ReliefComponentControls';

export function ReliefBrushControls(props: {
  readonly disabled: boolean;
  readonly mode: ReliefSculptStroke['mode'];
  readonly setMode: (mode: ReliefSculptStroke['mode']) => void;
  readonly diameter: number;
  readonly setDiameter: (value: number) => void;
  readonly strength: number;
  readonly setStrength: (value: number) => void;
  readonly flattenHeight: number;
  readonly setFlattenHeight: (value: number) => void;
  readonly vectors: ReadonlyArray<SceneObject>;
  readonly regionId: string;
  readonly setRegionId: (id: string) => void;
}): JSX.Element {
  return (
    <fieldset disabled={props.disabled}>
      <legend>Sculpt selected component</legend>
      <select
        title="Choose whether the sculpt brush adds, removes, smooths or flattens height"
        aria-label="Relief brush"
        value={props.mode}
        onChange={(e) => {
          props.setMode(e.target.value as ReliefSculptStroke['mode']);
          props.setStrength(e.target.value === 'add' || e.target.value === 'remove' ? 0.25 : 0.5);
        }}
      >
        {(['add', 'remove', 'smooth', 'flatten'] as const).map((m) => (
          <option key={m}>{m}</option>
        ))}
      </select>
      <NumberControl
        label="Brush diameter (physical mm)"
        value={props.diameter}
        commit={props.setDiameter}
      />
      <NumberControl
        label={
          props.mode === 'add' || props.mode === 'remove'
            ? 'Brush strength (mm per dab)'
            : 'Brush strength (0 to 1)'
        }
        value={props.strength}
        commit={props.setStrength}
      />
      {props.mode === 'flatten' ? (
        <NumberControl
          label="Flatten height above floor (mm)"
          value={props.flattenHeight}
          commit={props.setFlattenHeight}
        />
      ) : null}
      <label>
        Region{' '}
        <select
          title="Limit the sculpt stroke to the selected component or a linked vector region"
          aria-label="Relief brush region"
          value={props.regionId}
          onChange={(e) => props.setRegionId(e.target.value)}
        >
          <option value="">Whole selected component</option>
          {props.vectors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name ?? v.id}
            </option>
          ))}
        </select>
      </label>
      <p>
        Each completed stroke is one undo step. Escape or a cancelled pointer discards the current
        stroke.
      </p>
    </fieldset>
  );
}
