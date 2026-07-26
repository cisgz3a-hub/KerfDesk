import { CHIPLOAD_MATERIALS } from '../../core/cnc';

const MATERIAL_GROUPS = [...new Set(CHIPLOAD_MATERIALS.map((material) => material.group))];

/** Shared grouped options for CNC stock and layer material selectors. */
export function CncMaterialOptions(): JSX.Element {
  return (
    <>
      {MATERIAL_GROUPS.map((group) => (
        <optgroup key={group} label={group}>
          {CHIPLOAD_MATERIALS.filter((material) => material.group === group).map((material) => (
            <option key={material.value} value={material.value}>
              {material.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
