import { useEffect, useRef, useState } from 'react';
import { Button } from '../kit';
import { useSaveFilenameStore, type SaveFilenameRequest } from '../state/save-filename-store';

/** Non-modal by design: native prompts suspend the renderer, while this panel
 * leaves the live motion bar and its Stop action available during a job. */
export function SaveFilenamePanel(): JSX.Element | null {
  const request = useSaveFilenameStore((state) => state.queue[0] ?? null);
  if (request === null) return null;
  return <FilenameRequestPanel key={request.sequence} request={request} />;
}

function FilenameRequestPanel(props: { readonly request: SaveFilenameRequest }): JSX.Element {
  const [displayName, setDisplayName] = useState(props.request.suggestedName);
  const inputRef = useRef<HTMLInputElement>(null);
  const finish = useSaveFilenameStore((state) => state.finish);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <section
      aria-label="Choose G-code filename"
      role="dialog"
      style={panelStyle}
      onKeyDown={(event) => {
        if (event.key === 'Escape') finish(null);
      }}
    >
      <strong style={titleStyle}>Save G-code as</strong>
      <label style={labelStyle}>
        File name
        <input
          ref={inputRef}
          aria-label="G-code file name"
          title="Name of the G-code file to create"
          value={displayName}
          style={inputStyle}
          onChange={(event) => setDisplayName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') finish(displayName);
          }}
        />
      </label>
      <div style={actionsStyle}>
        <Button variant="primary" onClick={() => finish(displayName)}>
          Save
        </Button>
        <Button onClick={() => finish(null)}>Cancel</Button>
      </div>
      <span style={hintStyle}>
        The destination file is created only after preparation succeeds.
      </span>
    </section>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 72,
  right: 24,
  zIndex: 2_147_483_646,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: 320,
  maxWidth: 'calc(100vw - 48px)',
  padding: 14,
  boxSizing: 'border-box',
  color: 'var(--lf-text)',
  background: 'var(--lf-bg-1)',
  border: '1px solid var(--lf-border)',
  borderRadius: 'var(--lf-radius-lg)',
  boxShadow: 'var(--lf-shadow)',
};
const titleStyle: React.CSSProperties = { fontSize: 14 };
const labelStyle: React.CSSProperties = { display: 'grid', gap: 5, fontSize: 12 };
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 8px',
  color: 'var(--lf-text)',
  background: 'var(--lf-bg-0)',
  border: '1px solid var(--lf-border)',
  borderRadius: 'var(--lf-radius-sm)',
};
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};
const hintStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 11 };
