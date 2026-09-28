// ADR-496: the material this job runs on, and whether new operations take the
// library's best recipe for it by themselves. Also applies the best recipes to
// the operations already in the job, as one undo step.

import { useState } from 'react';
import { jobMaterialChoices, materialKey } from '../../core/material-library/auto-recipe';
import type { ProjectLaserMaterial } from '../../core/scene/project';
import type { MaterialLibraryDocument } from '../../io/material-library';
import { Button } from '../kit';
import { useStore } from '../state';
import type { BestRecipeResult } from '../state/material-library-actions';
import {
  buttonRowStyle,
  fieldStyle,
  hintStyle,
  labelStyle,
  statusStyle,
} from './material-library-panel-styles';

const NO_MATERIAL = '';
const ANY_THICKNESS = '';

export function JobMaterialControls(props: {
  readonly library: MaterialLibraryDocument;
}): JSX.Element {
  const material = useStore((state) => state.project.jobSetup.laserMaterial);
  const setJobLaserMaterial = useStore((state) => state.setJobLaserMaterial);
  const applyBestRecipes = useStore((state) => state.applyBestRecipesToOperations);
  const [status, setStatus] = useState('');
  const choices = jobMaterialChoices(props.library.entries);
  const selected = choices.find(
    (choice) => material !== undefined && materialKey(choice.name) === materialKey(material.name),
  );
  const thicknesses = selected?.thicknessesMm ?? [];
  type MaterialPatch = {
    readonly name?: string;
    readonly thicknessMm?: number | undefined;
    readonly autoApplyRecipes?: boolean;
  };
  const update = (patch: MaterialPatch | null): void => {
    setStatus('');
    if (patch === null) {
      setJobLaserMaterial(undefined);
      return;
    }
    const next = { name: '', autoApplyRecipes: true, ...material, ...patch };
    const { thicknessMm, ...rest } = next;
    setJobLaserMaterial(thicknessMm === undefined ? rest : { ...rest, thicknessMm });
  };
  return (
    <div aria-label="Job material" role="group">
      <label style={fieldStyle}>
        <span style={labelStyle}>Job material</span>
        <select
          aria-label="Job material"
          value={selected?.name ?? NO_MATERIAL}
          title="The material this job runs on. New operations can take this library's best recipe for it."
          onChange={(event) => {
            const name = event.currentTarget.value;
            update(name === NO_MATERIAL ? null : { name, thicknessMm: undefined });
          }}
        >
          <option value={NO_MATERIAL}>None</option>
          {choices.map((choice) => (
            <option key={choice.name} value={choice.name}>
              {choice.name}
            </option>
          ))}
        </select>
      </label>
      {material !== undefined ? (
        <JobMaterialDetail
          material={material}
          thicknesses={thicknesses}
          onThickness={(thicknessMm) => update({ thicknessMm })}
          onAutoApply={(autoApplyRecipes) => update({ autoApplyRecipes })}
          onApplyAll={() => setStatus(bestRecipeStatus(applyBestRecipes()))}
        />
      ) : null}
      {status !== '' ? (
        <p role="status" style={statusStyle}>
          {status}
        </p>
      ) : null}
    </div>
  );
}

function JobMaterialDetail(props: {
  readonly material: ProjectLaserMaterial;
  readonly thicknesses: ReadonlyArray<number>;
  readonly onThickness: (thicknessMm: number | undefined) => void;
  readonly onAutoApply: (on: boolean) => void;
  readonly onApplyAll: () => void;
}): JSX.Element {
  const thickness = props.material.thicknessMm;
  return (
    <>
      <label style={fieldStyle}>
        <span style={labelStyle}>Thickness</span>
        <select
          aria-label="Job material thickness"
          value={thickness === undefined ? ANY_THICKNESS : String(thickness)}
          title="Cuts take only a recipe for this thickness (or one for any thickness). Engravings prefer it but take another."
          onChange={(event) => {
            const value = event.currentTarget.value;
            props.onThickness(value === ANY_THICKNESS ? undefined : Number(value));
          }}
        >
          <option value={ANY_THICKNESS}>Not set</option>
          {props.thicknesses.map((value) => (
            <option key={value} value={String(value)}>
              {`${formatMm(value)} mm`}
            </option>
          ))}
        </select>
      </label>
      <label style={fieldStyle}>
        <span style={labelStyle}>New operations</span>
        <span style={checkboxRowStyle}>
          <input
            type="checkbox"
            className="lf-checkbox"
            aria-label="New operations take the best recipe"
            title="Each new operation, or one switched to another mode, links the best recipe for the job material."
            checked={props.material.autoApplyRecipes}
            onChange={(event) => props.onAutoApply(event.currentTarget.checked)}
          />
          <span>Take the best recipe</span>
        </span>
      </label>
      <p style={hintStyle}>
        A new operation, or one switched to another mode, links the library's best recipe for this
        material and its mode: this machine's own recipes first, then calibrated ones. Operations
        with no matching recipe keep their settings.
      </p>
      <div style={buttonRowStyle}>
        <Button
          aria-label="Apply best recipes to all operations"
          title="Link every output operation to the best recipe for the job material, as one undo step."
          onClick={props.onApplyAll}
        >
          Apply to all operations
        </Button>
      </div>
    </>
  );
}

function bestRecipeStatus(result: BestRecipeResult): string {
  const parts = [
    `${countText(result.applied, 'operation')} linked to their best recipe`,
    ...(result.alreadyCurrent > 0 ? [`${result.alreadyCurrent} already were`] : []),
  ];
  const none =
    result.unmatched.length > 0
      ? ` No recipe for: ${result.unmatched.join(', ')}; they keep their settings.`
      : '';
  return `${parts.join('; ')}.${none}`;
}

function countText(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function formatMm(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
};
