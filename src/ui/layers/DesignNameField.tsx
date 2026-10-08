import { useState } from 'react';
import { Button } from '../kit';
import { useStore } from '../state';
import { designRowName, type DesignTreeRow } from './design-tree-rows';

export function DesignNameField({
  row,
  close,
}: {
  readonly row: DesignTreeRow;
  readonly close: () => void;
}): JSX.Element {
  const [value, setValue] = useState(designRowName(row));
  const apply = (): void => {
    if (row.kind === 'group') useStore.getState().renameDesignGroup(row.group.id, value);
    else useStore.getState().renameArtwork(row.object.id, value);
    close();
  };
  return (
    <span style={{ display: 'flex', gap: 4 }}>
      <input
        className="lf-input"
        aria-label="Design name"
        title="Artwork names may be cleared to restore the default label. Group names must contain text."
        autoFocus
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            apply();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      />
      <Button
        title="Save this design name as one undoable edit."
        disabled={row.kind === 'group' && value.trim() === ''}
        onClick={apply}
      >
        Save name
      </Button>
      <Button title="Discard this name change." onClick={close}>
        Cancel name
      </Button>
    </span>
  );
}
