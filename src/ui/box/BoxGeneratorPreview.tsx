import type { CSSProperties } from 'react';
import { Button } from '../kit';
import { BoxAssembledPreview } from './BoxAssembledPreview';
import { BoxPreview } from './BoxPreview';
import { boxPreviewShouldBeSuppressed } from './box-preview-responsiveness';
import type { BoxGenerationSnapshot } from './use-box-generation';

export type BoxPreviewView = 'flat' | 'assembled';

export function BoxGeneratorPreview(props: {
  readonly view: BoxPreviewView;
  readonly onSelectView: (view: BoxPreviewView) => void;
  readonly snapshot: BoxGenerationSnapshot | null;
  readonly isPending: boolean;
}): JSX.Element {
  const isSuppressed =
    props.snapshot !== null && boxPreviewShouldBeSuppressed(props.snapshot.metrics);
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
        {isSuppressed && props.snapshot !== null ? (
          <PreviewFallback snapshot={props.snapshot} />
        ) : props.view === 'flat' ? (
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

function PreviewFallback(props: { readonly snapshot: BoxGenerationSnapshot }): JSX.Element {
  const { panelCount, ringCount, pointCount } = props.snapshot.metrics;
  return (
    <div role="img" aria-label="Generated panel geometry summary" style={fallbackStyle}>
      <strong>Preview hidden for responsiveness</strong>
      <span>
        {panelCount} panels · {ringCount} rings · {pointCount.toLocaleString()} points
      </span>
    </div>
  );
}

const viewToggleStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
  margin: '0 0 6px',
};

const fallbackStyle: CSSProperties = {
  alignItems: 'center',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  color: 'var(--lf-text-muted)',
  display: 'flex',
  flexDirection: 'column',
  fontSize: 12,
  gap: 4,
  justifyContent: 'center',
  minHeight: 180,
  textAlign: 'center',
};
