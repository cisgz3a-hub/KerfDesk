import type { ProcessRecipePreview } from '../../core/material-library/process-recipe-selectors';
import { hintStyle } from '../layers/material-library-panel-styles';

export function RecipeMatchPreview({
  name,
  preview,
}: {
  readonly name: string;
  readonly preview: ProcessRecipePreview;
}): JSX.Element {
  return (
    <section aria-label={'Template matches on ' + name}>
      <h4>{name}</h4>
      <ul>
        {preview.roles.map((entry) => (
          <li key={entry.role.id}>
            {entry.role.name}:{' '}
            {entry.status === 'missing'
              ? entry.role.required
                ? 'Required role missing'
                : 'Optional role missing'
              : entry.matches
                  .map(
                    (match) => match.objectId + ' (' + match.pathIndices.length + ' path groups)',
                  )
                  .join(', ')}
          </li>
        ))}
      </ul>
      <p style={hintStyle}>
        {preview.matchedObjectIds.length} matched artworks; {preview.unmatchedObjectIds.length}{' '}
        unmatched artworks. Unmatched artwork stays unchanged.
      </p>
      {preview.toolRemaps.length === 0 ? null : (
        <ul aria-label="Template cutter mappings">
          {preview.toolRemaps.map((mapping) => (
            <li key={mapping.from}>
              {mapping.name}:{' '}
              {mapping.from === mapping.to
                ? 'reuse / copy ' + mapping.to
                : mapping.from + ' → ' + mapping.to}
            </li>
          ))}
        </ul>
      )}
      {preview.warnings.length === 0 ? null : (
        <ul aria-label="Template advisories">
          {preview.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
