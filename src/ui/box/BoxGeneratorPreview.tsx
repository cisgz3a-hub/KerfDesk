import type { CSSProperties } from 'react';
import { Button } from '../kit';
import { BoxAssembledPreview } from './BoxAssembledPreview';
import { BoxPreview } from './BoxPreview';
import type { BoxGenerationSnapshot } from './use-box-generation';

export type BoxPreviewView = 'flat' | 'assembled';

export function BoxGeneratorPreview(props: {
  readonly view: BoxPreviewView;
  readonly onSelectView: (view: BoxPreviewView) => void;
  readonly snapshot: BoxGenerationSnapshot | null;
  readonly isPending: boolean;
}): JSX.Element {
  return (
    <>
      <div style={viewToggleStyle} role="group" aria-label="Preview view">
        <Button onClick={() => props.onSelectView('flat')} aria-pressed={props.view === 'flat'}>
          Flat
        </Button>
        <Button
          onClick={() => props.onSelectView('assembled')}
          aria-pressed={props.view === 'assembled'}
        >
          Assembled
        </Button>
      </div>
      <div aria-busy={props.isPending}>
        {props.view === 'flat' ? (
          <BoxPreview panels={props.snapshot?.panels ?? null} />
        ) : (
          <BoxAssembledPreview
            panels={props.snapshot?.panels ?? null}
            spec={props.snapshot?.spec ?? null}
          />
        )}
      </div>
    </>
  );
}

const viewToggleStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
  margin: '0 0 6px',
};
