type ArtworkRunOrderToolbarProps = {
  readonly search: string;
  readonly total: number;
  readonly jumpPosition: string;
  readonly numbering:
    | { readonly kind: 'idle' }
    | { readonly kind: 'active'; readonly nextPosition: number; readonly canUndo: boolean };
  readonly onSearch: (value: string) => void;
  readonly onJumpPosition: (value: string) => void;
  readonly onJump: () => void;
  readonly onStartNumbering: () => void;
  readonly onUndoNumbering: () => void;
  readonly onDoneNumbering: () => void;
  readonly onCancelNumbering: () => void;
};

export function ArtworkRunOrderToolbar(props: ArtworkRunOrderToolbarProps): JSX.Element {
  if (props.numbering.kind === 'active') {
    return <CanvasNumberingControls {...props} numbering={props.numbering} />;
  }
  return <RunOrderTools {...props} />;
}

function CanvasNumberingControls(
  props: Pick<
    ArtworkRunOrderToolbarProps,
    'onUndoNumbering' | 'onDoneNumbering' | 'onCancelNumbering'
  > & {
    readonly numbering: Extract<ArtworkRunOrderToolbarProps['numbering'], { kind: 'active' }>;
  },
): JSX.Element {
  return (
    <section aria-label="Canvas numbering controls" style={numberingStyle}>
      <div>
        <strong>Click artwork for run #{props.numbering.nextPosition}</strong>
        <p style={hintStyle}>Each click assigns the next number. Existing colors stay unchanged.</p>
      </div>
      <div style={buttonRowStyle}>
        <button
          type="button"
          title="Undo the most recent canvas run-number assignment"
          disabled={!props.numbering.canUndo}
          onClick={props.onUndoNumbering}
        >
          Undo last
        </button>
        <button
          type="button"
          title="Finish numbering and save it as one undoable change"
          className="lf-btn lf-btn--primary"
          onClick={props.onDoneNumbering}
        >
          Done
        </button>
        <button
          type="button"
          title="Cancel numbering and restore the original run order"
          className="lf-btn lf-btn--ghost"
          onClick={props.onCancelNumbering}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

function RunOrderTools(
  props: Pick<
    ArtworkRunOrderToolbarProps,
    | 'search'
    | 'total'
    | 'jumpPosition'
    | 'onSearch'
    | 'onJumpPosition'
    | 'onJump'
    | 'onStartNumbering'
  >,
): JSX.Element {
  return (
    <section aria-label="Artwork run order tools" style={toolbarStyle}>
      <div style={searchRowStyle}>
        <input
          type="search"
          value={props.search}
          aria-label="Search artwork jobs"
          title="Filter run units by artwork, operation, or settings"
          placeholder={`Search ${props.total} jobs`}
          style={searchStyle}
          onChange={(event) => props.onSearch(event.currentTarget.value)}
        />
        <button
          type="button"
          title="Assign run numbers by clicking artwork on the canvas"
          className="lf-btn lf-btn--primary"
          onClick={props.onStartNumbering}
        >
          Number on canvas
        </button>
      </div>
      <div style={jumpRowStyle}>
        <span style={hintStyle}>Jump to run</span>
        <input
          type="number"
          min={1}
          max={Math.max(1, props.total)}
          value={props.jumpPosition}
          aria-label="Jump to run number"
          title="Enter a run number to reveal it"
          style={jumpInputStyle}
          onChange={(event) => props.onJumpPosition(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') props.onJump();
          }}
        />
        <button type="button" title="Reveal the entered run number" onClick={props.onJump}>
          Go
        </button>
        <span style={{ ...hintStyle, marginLeft: 'auto' }}>{props.total} run units</span>
      </div>
    </section>
  );
}

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
  paddingBottom: 9,
  borderBottom: '1px solid var(--lf-border)',
};
const numberingStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
  padding: 9,
  border: '1px solid var(--lf-accent)',
  borderRadius: 6,
  background: 'var(--lf-accent-wash)',
};
const searchRowStyle: React.CSSProperties = { display: 'flex', gap: 6 };
const searchStyle: React.CSSProperties = { minWidth: 0, flex: 1 };
const jumpRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const jumpInputStyle: React.CSSProperties = { width: 64 };
const buttonRowStyle: React.CSSProperties = { display: 'flex', gap: 6 };
const hintStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 11,
};
