// DesignKeptDrawingBar — offers a kept Studio drawing back (ADR-590
// Amendments 1 to 3). A drawing not yet applied, or an applied one that no
// saved file or autosave holds, is never written over when the Studio opens on
// another project; it waits here until it is restored or discarded, or its own
// project opens it again. The bar names the project it came from, since
// Restore and Apply put it in this one.

import { useState, useSyncExternalStore } from 'react';
import {
  discardKeptDesignDrawing,
  keptDrawingSource,
  keptTimeLabel,
  readKeptDesignDrawings,
  shapeCount,
  subscribeKeptDesignDrawings,
  type KeptDesignDrawing,
} from './design-kept-drawings';
import { restoreKeptDesignDrawing } from './design-kept-drawing-actions';

export function DesignKeptDrawingBar(): JSX.Element | null {
  const kept = useSyncExternalStore(subscribeKeptDesignDrawings, readKeptDesignDrawings);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const newest = kept[0];
  if (newest === undefined) return null;
  const older = kept.length - 1;
  return (
    <div role="region" aria-label="Kept drawing" style={barStyle}>
      <span style={textStyle}>
        {keptDrawingLead(newest)} was kept: {shapeCount(newest)}, kept {keptTimeLabel(newest.keptAt)}.
        {older > 0 ? ` ${older} older kept.` : ''}
        {failed ? ' It could not be restored; try again.' : ''}
      </span>
      <button
        type="button"
        title="Open the kept drawing here; Apply puts it in this project. A drawing it replaces that you have not applied is kept in its place."
        onClick={() => {
          setConfirming(null);
          void restoreKeptDesignDrawing(newest.id).then((restored) => setFailed(!restored));
        }}
      >
        Restore
      </button>
      {confirming === newest.id ? (
        <>
          <span>Discard it for good?</span>
          <button
            type="button"
            title="Delete the kept drawing. This cannot be undone."
            onClick={() => {
              setConfirming(null);
              discardKeptDesignDrawing(newest.id);
            }}
          >
            Discard
          </button>
          <button type="button" title="Keep the drawing" onClick={() => setConfirming(null)}>
            Keep
          </button>
        </>
      ) : (
        <button
          type="button"
          title="Delete the kept drawing (asks first)"
          onClick={() => setConfirming(newest.id)}
        >
          Discard…
        </button>
      )}
    </div>
  );
}

// Drawings kept before ADR-590 Amendment 3 do not name their project.
function keptDrawingLead(drawing: KeptDesignDrawing): string {
  const source = keptDrawingSource(drawing);
  if (drawing.dirtySinceApply !== false)
    return source === null
      ? 'A drawing you had not applied'
      : `A drawing you had not applied, from ${source},`;
  return source === null
    ? 'An applied drawing this project does not hold'
    : `A drawing applied to ${source} that no saved file or autosave holds`;
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--lf-space-2)',
  padding: '4px 10px',
  borderBottom: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-2)',
  fontSize: 12,
  color: 'var(--lf-text)',
};

const textStyle: React.CSSProperties = { flex: 1 };
