import { useState } from 'react';
import type { CncMachineConfig } from '../../core/scene';
import { AddCncBitForm } from '../machine/AddCncBitForm';
import { CncBitCatalogPanel } from '../machine/CncBitCatalogPanel';
import { RailSection } from '../kit';
import { useStore } from '../state';

/** Load the catalog on demand and retain custom-bit drafts when folded away. */
export function CncOperationBitLibrary(props: { readonly machine: CncMachineConfig }): JSX.Element {
  const [requested, setRequested] = useState(false);
  const customTools = useStore((state) => state.cncLibrary.customTools);
  return (
    <details
      className="lf-section"
      onToggle={(event) => {
        if (event.currentTarget.open) setRequested(true);
      }}
    >
      <summary title="Browse the existing catalog or add a custom bit without leaving this operation.">
        <span>Add another bit</span>
      </summary>
      {requested ? (
        <div className="lf-section-body">
          <p className="lf-cnc-settings-hint">
            Add to your saved bit library, then choose the bit above for this operation.
          </p>
          <CncBitCatalogPanel customTools={[...props.machine.tools, ...customTools]} />
          <RailSection label="Add custom bit" hint="Enter the dimensions of your own cutter.">
            <AddCncBitForm />
          </RailSection>
        </div>
      ) : null}
    </details>
  );
}
