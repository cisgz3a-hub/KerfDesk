import { useEffect, useState } from 'react';
import type {
  ProcessRecipe,
  ProcessRecipeGeometry,
  ProcessRecipeRole,
  ProcessRecipeSelector,
} from '../../core/material-library/process-recipe';
import { useStore } from '../state';
import { Button } from '../kit';
import { fieldStyle, hintStyle, labelStyle } from '../layers/material-library-panel-styles';

export function MachiningTemplateEditor({
  recipe,
}: {
  readonly recipe: ProcessRecipe;
}): JSX.Element {
  const update = useStore((state) => state.updateProcessRecipeRoles);
  const [roles, setRoles] = useState(recipe.roles ?? []);
  const [dependencies, setDependencies] = useState(
    recipe.steps.map((step) => step.dependsOn ?? []),
  );
  const [status, setStatus] = useState('');
  useEffect(() => {
    setRoles(recipe.roles ?? []);
    setDependencies(recipe.steps.map((step) => step.dependsOn ?? []));
  }, [recipe]);
  const patch = (id: string, selector: ProcessRecipeSelector): void =>
    setRoles(roles.map((role) => (role.id === id ? { ...role, selector } : role)));
  const save = (): void => {
    const result = update(recipe.id, roles, dependencies);
    setStatus(
      result.kind === 'invalid'
        ? result.reason
        : 'Saved selectors in revision ' +
            result.value.revision +
            '. Existing applications keep their reviewed revision until reapplied.',
    );
  };
  return (
    <details aria-label="Machining template selectors">
      <summary title="Edit semantic roles and the artwork selectors used by this template">
        Semantic roles and selectors
      </summary>
      <p style={hintStyle}>
        Conditions combine. Names match exact labels, ignoring case. A named group path matches that
        hierarchy or its final named groups. A path group keeps all nested holes together.
      </p>
      {roles.map((role) => (
        <RoleCard
          key={role.id}
          role={role}
          onSelector={(selector) => patch(role.id, selector)}
          onChange={(updated) =>
            setRoles(roles.map((entry) => (entry.id === role.id ? updated : entry)))
          }
        />
      ))}
      {recipe.steps.map((step, index) => (
        <label style={fieldStyle} key={index}>
          <span style={labelStyle}>
            {index + 1}. {step.name}: after steps
          </span>
          <input
            title="Enter comma-separated step numbers that must run before this step"
            aria-label={'Dependencies for step ' + (index + 1)}
            value={(dependencies[index] ?? []).map((value) => value + 1).join(', ')}
            onChange={(event) => {
              const next = [...dependencies];
              next[index] =
                event.currentTarget.value.trim() === ''
                  ? []
                  : event.currentTarget.value.split(',').map((value) => Number(value.trim()) - 1);
              setDependencies(next);
            }}
          />
        </label>
      ))}
      <Button onClick={save}>Save role selectors</Button>
      {status === '' ? null : <p role="status">{status}</p>}
    </details>
  );
}

interface RoleSelectorProps {
  readonly role: ProcessRecipeRole;
  readonly onChange: (selector: ProcessRecipeSelector) => void;
}

function RoleArtworkNameSelector({ role, onChange }: RoleSelectorProps): JSX.Element {
  const selector = role.selector;
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>Artwork name</span>
      <input
        title="Match artwork by its retained name"
        aria-label={'Artwork selector ' + role.id}
        value={selector.objectName ?? ''}
        onChange={(event) =>
          onChange({
            ...selector,
            objectName:
              event.currentTarget.value.trim() === '' ? undefined : event.currentTarget.value,
          })
        }
      />
    </label>
  );
}

function RoleSelector({ role, onChange }: RoleSelectorProps): JSX.Element {
  const selector = role.selector;
  return (
    <>
      <RoleArtworkNameSelector role={role} onChange={onChange} />
      <label style={fieldStyle}>
        <span style={labelStyle}>Named group path (separate with /)</span>
        <input
          title="Match a named group path; separate nested group names with a slash"
          aria-label={'Group selector ' + role.id}
          value={selector.groupPath?.join(' / ') ?? ''}
          onChange={(event) =>
            onChange({
              ...selector,
              groupPath:
                event.currentTarget.value.trim() === ''
                  ? undefined
                  : event.currentTarget.value.split('/').map((name) => name.trim()),
            })
          }
        />
      </label>
      <label style={fieldStyle}>
        <span style={labelStyle}>Geometry</span>
        <select
          title="Choose which path geometry can satisfy this role"
          aria-label={'Geometry selector ' + role.id}
          value={selector.geometry}
          onChange={(event) =>
            onChange({ ...selector, geometry: event.currentTarget.value as ProcessRecipeGeometry })
          }
        >
          <option value="any">All vector path groups</option>
          <option value="closed">Closed paths with their holes</option>
          <option value="open">Open paths</option>
          <option value="circular">Circular closed paths</option>
        </select>
      </label>
      <label style={fieldStyle}>
        <span style={labelStyle}>Artwork type</span>
        <select
          title="Restrict this role to the chosen artwork type"
          aria-label={'Artwork type selector ' + role.id}
          value={selector.objectKind ?? ''}
          onChange={(event) =>
            onChange({
              ...selector,
              objectKind:
                event.currentTarget.value === ''
                  ? undefined
                  : (event.currentTarget.value as ProcessRecipeSelector['objectKind']),
            })
          }
        >
          <option value="">Any vector artwork</option>
          <option value="text">Editable lettering</option>
          <option value="shape">Shape</option>
          <option value="imported-svg">Imported vector</option>
          <option value="traced-image">Traced image</option>
        </select>
      </label>
    </>
  );
}

function RoleCard({
  role,
  onSelector,
  onChange,
}: {
  readonly role: ProcessRecipeRole;
  readonly onSelector: (selector: ProcessRecipeSelector) => void;
  readonly onChange: (role: ProcessRecipeRole) => void;
}): JSX.Element {
  return (
    <fieldset>
      <legend>{role.name}</legend>
      <RoleSelector role={role} onChange={onSelector} />
      <label style={fieldStyle}>
        <span style={labelStyle}>Role name</span>
        <input
          title="Name this semantic machining role"
          aria-label={'Role name ' + role.id}
          value={role.name}
          onChange={(event) => onChange({ ...role, name: event.currentTarget.value })}
        />
      </label>
      <label>
        <input
          title="Require matching artwork for this role when applying the template"
          type="checkbox"
          checked={role.required}
          onChange={(event) => onChange({ ...role, required: event.currentTarget.checked })}
        />
        Required role
      </label>
      <p style={hintStyle}>
        Applies steps {role.stepIndices.map((index) => index + 1).join(', ')}.
      </p>
    </fieldset>
  );
}
