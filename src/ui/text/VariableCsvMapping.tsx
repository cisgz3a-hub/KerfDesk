import { useState } from 'react';
import { parseVariableTemplateSource, variableTemplateToSource } from '../../core/variables';
import { Button } from '../kit';

/** Column names are the persisted mapping; changing one updates the editable source. */
export function VariableCsvMapping(props: {
  readonly headers: ReadonlyArray<string>;
  readonly source?: string;
  readonly onSourceChange?: (source: string) => void;
  readonly onInsert: (source: string) => void;
}): JSX.Element | null {
  const [chosen, setChosen] = useState('');
  const column = props.headers.includes(chosen) ? chosen : props.headers[0];
  if (column === undefined) return null;
  const parsed = props.source === undefined ? null : parseVariableTemplateSource(props.source);
  const mapped = parsed?.ok
    ? [
        ...new Set(
          parsed.template.tokens.flatMap((token) => (token.kind === 'csv' ? [token.column] : [])),
        ),
      ]
    : [];
  const remap = (from: string, to: string): void => {
    if (parsed?.ok !== true || props.onSourceChange === undefined) return;
    props.onSourceChange(
      variableTemplateToSource({
        ...parsed.template,
        tokens: parsed.template.tokens.map((token) =>
          token.kind === 'csv' && token.column === from ? { ...token, column: to } : token,
        ),
      }),
    );
  };
  return (
    <section aria-label="CSV column mapping" style={{ display: 'grid', gap: 6 }}>
      <label>
        CSV column{' '}
        <select
          aria-label="CSV column to insert"
          title="Choose any imported column to insert into the text."
          value={column}
          onChange={(event) => setChosen(event.currentTarget.value)}
        >
          {props.headers.map((header) => (
            <option key={header} value={header}>
              {header}
            </option>
          ))}
        </select>{' '}
        <Button
          title="Insert the selected CSV field."
          onClick={() =>
            props.onInsert(variableTemplateToSource({ tokens: [{ kind: 'csv', column }] }))
          }
        >
          Insert column
        </Button>
      </label>
      {props.onSourceChange === undefined
        ? null
        : mapped.map((name) => (
            <label key={name}>
              Map {name} to{' '}
              <select
                aria-label={`Map CSV field ${name}`}
                title="Reassign every occurrence of this CSV field in the template."
                value={name}
                onChange={(event) => remap(name, event.currentTarget.value)}
              >
                {props.headers.includes(name) ? null : (
                  <option value={name}>{name} (missing)</option>
                )}
                {props.headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </label>
          ))}
    </section>
  );
}
