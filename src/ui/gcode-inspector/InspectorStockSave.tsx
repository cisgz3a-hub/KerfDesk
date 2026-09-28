// "Save as STL…" in the Inspector's Stock section (ADR-487): the stock as
// carved so far, as a closed STL solid in the program's millimetres. The file
// is picked first, while the click still counts as the operator's, and the
// worker writes the solid after.

import { useState } from 'react';
import { usePlatformOptional } from '../app/platform-context';
import type { StockStl } from './stock-stl';

export const STL_SUGGESTED_NAME = 'carved-stock.stl';

export function InspectorStockSave(props: {
  readonly stl: (() => Promise<StockStl | null>) | null;
}): JSX.Element | null {
  const platform = usePlatformOptional();
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (platform === null) return null;
  const { stl } = props;
  const save = async (): Promise<void> => {
    if (stl === null) return;
    const target = await platform.pickFileForSave({
      suggestedName: STL_SUGGESTED_NAME,
      extensions: ['.stl'],
    });
    if (target === null) return;
    setSaving(true);
    setNote('Writing the STL…');
    const solid = await stl();
    if (solid === null) {
      setNote('Nothing of the stock is left to save.');
      return;
    }
    await target.write(new Blob([solid.bytes], { type: 'model/stl' }));
    setNote(
      `Saved ${target.displayName}: ${solid.triangles.toLocaleString('en-US')} triangles, ${megabytes(solid.bytes.byteLength)}.`,
    );
  };
  const onClick = (): void => {
    void save()
      .catch((error: unknown) =>
        setNote(
          `The STL could not be saved: ${error instanceof Error ? error.message : 'unknown error'}.`,
        ),
      )
      .finally(() => setSaving(false));
  };
  return (
    <>
      <button
        type="button"
        className="lf-btn"
        title="Save the stock as carved so far as a closed STL solid, in millimetres, for another program to open"
        disabled={stl === null || saving}
        onClick={onClick}
        style={buttonStyle}
      >
        Save as STL…
      </button>
      {note === null ? null : (
        <p role="status" style={noteStyle}>
          {note}
        </p>
      )}
    </>
  );
}

function megabytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return mb < 0.1 ? `${Math.max(1, Math.round(bytes / 1000))} kB` : `${mb.toFixed(1)} MB`;
}

const buttonStyle: React.CSSProperties = { justifySelf: 'start', marginTop: 2 };

const noteStyle: React.CSSProperties = {
  margin: '2px 0 0',
  color: 'var(--lf-text-muted)',
  fontSize: 'var(--lf-text-xs)',
};
